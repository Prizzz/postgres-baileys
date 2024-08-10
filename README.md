# postgres-baileys

A robust and reliable Node.js package designed to seamlessly persist your `@whiskeysockets/baileys` WhatsApp session data within a PostgreSQL database. 

**Key Benefits**

* **Persistent Sessions:** Maintain uninterrupted WhatsApp bot connectivity, even across server restarts or crashes
* **Scalability:** PostgreSQL's robust architecture supports handling large volumes of session data as your bot usage grows. 
* **TypeScript Support:** Leverages TypeScript for enhanced type safety and improved code maintainability.

## Installation

Install the package using npm or yarn:

```bash
npm install postgres-baileys
```

## Getting Started

```javascript
import { makeWASocket } from "@whiskeysockets/baileys";
import { usePostgreSQLAuthState } from "postgres-baileys"; 

const postgreSQLConfig = {
  host: 'your-postgresql-host',
  port: 5432, 
  user: 'your-postgresql-user',
  password: 'your-postgresql-password',
  database: 'your-postgresql-database',
};

async function main() {
  try {
    const { state, saveCreds } = await usePostgreSQLAuthState(postgreSQLConfig, "your-unique-session-id");

    const sock = makeWASocket({
      printQRInTerminal: true,
      auth: state
    });

    sock.ev.on("creds.update", saveCreds); 

    console.log("WebSocket connected");
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
```

## Core Concepts

1. **PostgreSQL Configuration:** Provide accurate connection details for your PostgreSQL database.
2. **Session ID:** A unique identifier for your WhatsApp session. Use a consistent ID to resume the same session across restarts.
3. **`usePostgreSQLAuthState`:** Fetches or initializes session data from the database, returning the current state and a `saveCreds` function.
4. **`makeWASocket`:** Create your Baileys connection, passing in the retrieved `state`.
5. **`creds.update` Event:**  Listen for this event to automatically persist updated credentials to the database using the `saveCreds` function.

## Advanced Usage

```javascript
import { initAuthCreds } from "postgres-baileys";

// ...

// Manual credential initialization (optional)
const authCreds = initAuthCreds(); 

// ... (Use authCreds in your Baileys configuration if needed)
```

## API Reference

* **`usePostgreSQLAuthState(config, sessionId)`**
    * `config`:  PostgreSQL connection configuration object
    * `sessionId`:  Unique string identifier for your session
    * Returns:  
        * `state`: The current authentication state or a newly initialized one.
        * `saveCreds`: A function to save updated credentials to the database

* **`initAuthCreds()`**
   * Returns: A freshly generated set of Baileys authentication credentials.

## Important Considerations

* **Database Setup:** Ensure your PostgreSQL database is set up and accessible. 
* **Error Handling:** Implement robust error handling, especially for database connection issues.


