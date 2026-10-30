use postgres_native_tls::MakeTlsConnector;
use std::time::Duration;

const QUERY: &str = "SELECT current_database() AS database;";

pub async fn connect(connection_string: &str) -> Result<String, String> {
    if !connection_string.starts_with("postgres://")
        && !connection_string.starts_with("postgresql://")
    {
        return Err("Use a connection string starting with postgres:// or postgresql://.".into());
    }

    let mut config = connection_string
        .parse::<tokio_postgres::Config>()
        .map_err(|_| "Invalid PostgreSQL connection string. Check the URI format and percent-encode special characters in credentials.".to_string())?;
    config.connect_timeout(Duration::from_secs(10));

    let tls = native_tls::TlsConnector::builder()
        .build()
        .map_err(|_| "Could not initialize TLS for PostgreSQL.".to_string())?;
    let (client, connection) = config
        .connect(MakeTlsConnector::new(tls))
        .await
        .map_err(|error| match error.code().map(|code| code.code()) {
            Some("28P01" | "28000") => "PostgreSQL rejected the credentials. Check your username and password.",
            Some("3D000") => "That PostgreSQL database does not exist. Check the database name in your connection string.",
            _ => "Could not connect to PostgreSQL. Check the host, port, credentials, and SSL settings. If using TLS, the server certificate must be trusted by your system.",
        }.to_string())?;

    // Poll the connection alongside the query, so dropping this future also closes the socket.
    let row = tokio::select! {
        result = client.query_one(QUERY, &[]) => result
            .map_err(|_| "Connected to PostgreSQL, but the read-only query failed. Check your database permissions.".to_string())?,
        _ = connection => return Err("PostgreSQL closed the connection before the query completed. Try again.".into()),
    };

    row.try_get("database")
        .map_err(|_| "PostgreSQL returned an unexpected database name.".to_string())
}
