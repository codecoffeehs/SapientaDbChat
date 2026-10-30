use tiberius::{Client, Config};
use tokio::net::TcpStream;
use tokio_util::compat::TokioAsyncWriteCompatExt;

const QUERY: &str = "SELECT DB_NAME() AS [database];";

pub async fn connect(connection_string: &str) -> Result<String, String> {
    let config = Config::from_ado_string(connection_string)
        .map_err(|_| "Invalid SQL Server connection string. Use Server=tcp:host,port;Database=name;User Id=user;Password=password; with SQL Server authentication.".to_string())?;

    let tcp = TcpStream::connect(config.get_addr())
        .await
        .map_err(|_| "Could not reach SQL Server. Check the hostname and port, enable TCP/IP on the server, and check your firewall or VPN.".to_string())?;
    tcp.set_nodelay(true)
        .map_err(|_| "Could not configure the SQL Server connection.".to_string())?;

    let mut client = Client::connect(config, tcp.compat_write())
        .await
        .map_err(|_| "SQL Server could not complete the connection. Check your SQL login, database name, and TLS certificate settings.".to_string())?;
    let row = client.simple_query(QUERY)
        .await
        .map_err(|_| "Connected to SQL Server, but the read-only query failed. Check your database permissions.".to_string())?
        .into_row()
        .await
        .map_err(|_| "Could not read the SQL Server query response.".to_string())?
        .ok_or_else(|| "SQL Server returned no connection details.".to_string())?;

    let database = row
        .try_get::<&str, _>("database")
        .map_err(|_| "SQL Server returned an unexpected database name.".to_string())?
        .ok_or_else(|| "SQL Server returned an empty database name.".to_string())?
        .to_string();
    Ok(database)
}
