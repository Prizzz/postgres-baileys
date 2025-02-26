import { Pool, PoolClient } from 'pg';
import { proto } from '@whiskeysockets/baileys/WAProto';
import { Curve, signedKeyPair } from '@whiskeysockets/baileys/lib/Utils/crypto';
import { generateRegistrationId } from '@whiskeysockets/baileys/lib/Utils/generics';
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { AuthenticationCreds } from '@whiskeysockets/baileys';

// Interface for PostgreSQL Configurations
interface PostgreSQLConfig {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    ssl?: boolean | any; // Optional SSL options
}

// Interface for Authentication State
interface State {
    creds: AuthenticationCreds;
    keys: {
        get: (type: string, ids: string[]) => Promise<Record<string, any>>;
        set: (data: Record<string, Record<string, any>>) => Promise<void>;
    };
}

// Utility functions for converting between buffer and JSON
function bufferToJSON(obj: any): any {
    if (Buffer.isBuffer(obj)) {
        return { type: 'Buffer', data: Array.from(obj) };
    } else if (Array.isArray(obj)) {
        return obj.map(bufferToJSON);
    } else if (typeof obj === 'object' && obj !== null) {
        if (typeof obj.toJSON === 'function') {
            return obj.toJSON();
        }
        const result: { [key: string]: any } = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                result[key] = bufferToJSON(obj[key]);
            }
        }
        return result;
    }
    return obj;
}

function jsonToBuffer(obj: any): any {
    if (obj && obj.type === 'Buffer' && Array.isArray(obj.data)) {
        return Buffer.from(obj.data);
    } else if (Array.isArray(obj)) {
        return obj.map(jsonToBuffer);
    } else if (typeof obj === 'object' && obj !== null) {
        const result: { [key: string]: any } = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                result[key] = jsonToBuffer(obj[key]);
            }
        }
        return result;
    }
    return obj;
}

// Function to initialize authentication credentials
const initAuthCreds = (): AuthenticationCreds => {
    const identityKey = Curve.generateKeyPair();
    return {
        noiseKey: Curve.generateKeyPair(),
        signedIdentityKey: identityKey,
        signedPreKey: signedKeyPair(identityKey, 1),
        registrationId: generateRegistrationId(),
        advSecretKey: randomBytes(32).toString('base64'),
        processedHistoryMessages: [],
        nextPreKeyId: 1,
        firstUnuploadedPreKeyId: 1,
        accountSyncCounter: 0,
        accountSettings: {
            unarchiveChats: false,
        },
        deviceId: randomBytes(16).toString('base64'),
        phoneId: uuidv4(),
        identityId: randomBytes(20),
        registered: false,
        backupToken: randomBytes(20),
        registration: {} as any,
        pairingEphemeralKeyPair: Curve.generateKeyPair(),
        pairingCode: undefined,
        lastPropHash: undefined,
        routingInfo: undefined,
    };
};

// Class to handle PostgreSQL operations
class PostgreSQLAuthState {
    private pool: Pool;
    private sessionId: string;

    constructor(poolOrConfig: Pool | PostgreSQLConfig, sessionId: string) {
        this.pool = poolOrConfig instanceof Pool ? poolOrConfig : new Pool(poolOrConfig);
        this.sessionId = sessionId;
        this.ensureTableExists().catch(console.error); // Добавил логирование ошибок
    }

    private async ensureTableExists(): Promise<void> {
        const query = `
            CREATE TABLE IF NOT EXISTS auth_data (
                session_key VARCHAR(255) PRIMARY KEY,
                data TEXT NOT NULL
            )
        `;
        await this.executeQuery(query);
    }

    private getKey(key: string): string {
        return `${this.sessionId}:${key}`;
    }

    private async executeQuery(query: string, params: any[] = []): Promise<any> {
        const client: PoolClient = await this.pool.connect();
        try {
            const result = await client.query(query, params);
            return result.rows;
        } catch (err) {
            console.error('Database query error:', err);
            throw err;
        } finally {
            client.release();
        }
    }

    private async writeData(key: string, data: any): Promise<void> {
        const serialized = JSON.stringify(bufferToJSON(data));
        await this.executeQuery(
            'INSERT INTO auth_data (session_key, data) VALUES ($1, $2) ON CONFLICT (session_key) DO UPDATE SET data = EXCLUDED.data',
            [this.getKey(key), serialized]
        );
    }

    private async readData(key: string): Promise<any | null> {
        const rows = await this.executeQuery(
            'SELECT data FROM auth_data WHERE session_key = $1',
            [this.getKey(key)]
        );
        return rows.length ? jsonToBuffer(JSON.parse(rows[0].data)) : null;
    }

    private async removeData(key: string): Promise<void> {
        await this.executeQuery('DELETE FROM auth_data WHERE session_key = $1', [this.getKey(key)]);
    }

    public async getAuthState(): Promise<State> {
        const creds = (await this.readData('auth_creds')) || initAuthCreds();
        return {
            creds,
            keys: {
                get: async (type: string, ids: string[]) => {
                    const data: Record<string, any> = {};
                    for (const id of ids) {
                        const value = await this.readData(`${type}-${id}`);
                        data[id] = type === 'app-state-sync-key' && value
                            ? proto.Message.AppStateSyncKeyData.fromObject(value)
                            : value;
                    }
                    return data;
                },
                set: async (data: Record<string, Record<string, any>>) => {
                    for (const [category, categoryData] of Object.entries(data)) {
                        for (const [id, value] of Object.entries(categoryData || {})) {
                            const key = `${category}-${id}`;
                            value ? await this.writeData(key, value) : await this.removeData(key);
                        }
                    }
                },
            },
        };
    }

    public async saveCreds(creds: AuthenticationCreds): Promise<void> {
        await this.writeData('auth_creds', creds);
    }

    public async deleteSession(): Promise<void> {
        await this.executeQuery('DELETE FROM auth_data WHERE session_key LIKE $1', [`${this.sessionId}:%`]);
    }
}

// Function to use PostgreSQL Authentication State
async function usePostgreSQLAuthState(poolOrConfig: Pool | PostgreSQLConfig, sessionId: string) {
    const authState = new PostgreSQLAuthState(poolOrConfig, sessionId);
    const state = await authState.getAuthState();

    return {
        state,
        saveCreds: async () => {
            await authState.saveCreds(state.creds);
        },
        deleteSession: async () => {
            await authState.deleteSession();
        },
    };
}

export { usePostgreSQLAuthState, initAuthCreds };
