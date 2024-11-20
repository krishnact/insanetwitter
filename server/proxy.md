

Here’s a `proxy.js` class implementation that fulfills your requirements. The proxy will:

1. Authenticate with the main server using username and password from `proxy.config.json`.
2. Use a local SQLite database to store profiles.
3. Query multiple usernames in a single request.
4. Remove outdated profiles from the database (based on a configurable time threshold).
5. Fetch missing or outdated profiles from the server and update the database.
6. Skip storing profiles with a `null` `joiningDate`.

### Key Features

1. **Local Database for Profiles**:
   - Uses SQLite to store profiles and their last update time.
   - Profiles with `null` `joiningDate` are ignored.

2. **Outdated Profile Management**:
   - Deletes profiles older than the configured `maxAgeInDays` from the database.
   - Ensures only fresh profiles are served.

3. **Batch Fetching**:
   - Accepts a list of usernames via query parameters.
   - Combines results from the local database and server as needed.

4. **Server Communication**:
   - Authenticates with the main server using credentials in `proxy.config.json`.

---

### `proxy.config.json` Example

```json
{
  "username": "proxyUser",
  "password": "securePassword123",
  "serverUrl": "http://localhost:3000",
  "maxAgeInDays": 7,
  "port": 4000
}
```

---

### Running the Proxy

1. Save the proxy code in a file named `proxy.js`.
2. Create `proxy.config.json` with your server details and configuration.
3. Start the proxy server:

   ```bash
   node proxy.js
   ```

4. Query the proxy for profiles:

   ```bash
   curl "http://localhost:4000/profiles?usernames=username1,username2"
   ```

The proxy will query the database first, delete outdated profiles, fetch missing ones from the server, and return all valid profiles. 