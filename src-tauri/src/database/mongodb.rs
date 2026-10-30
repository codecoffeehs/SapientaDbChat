use mongodb::{
    Client,
    bson::doc,
    error::{Error, ErrorKind},
    options::{ClientOptions, ConnectionString, HostInfo, ResolverConfig},
};
use std::time::Duration;

fn connection_error(error: Error) -> String {
    // Only DNS errors expose their diagnostic text: they contain host/record details,
    // not URI credentials. Other driver messages can contain sensitive input.
    match error.kind.as_ref() {
        ErrorKind::DnsResolve { message, .. } => format!(
            "MongoDB DNS lookup failed: {message}. The Atlas SRV/TXT records could not be resolved. Check your DNS or VPN settings and confirm the cluster is active in Atlas. You can also use the standard mongodb:// connection string supplied by Atlas."
        ),
        ErrorKind::InvalidArgument { .. } => "MongoDB rejected the connection format or options. Copy the URI from Atlas, remove surrounding quotes, and percent-encode special characters in the username or password.".into(),
        ErrorKind::Authentication { .. } => "MongoDB authentication failed. Check the Atlas database user's credentials (not your Atlas account login) and the authSource option.".into(),
        ErrorKind::Command(command) if command.code == 18 => "MongoDB authentication failed. Check the database username, password, and authSource.".into(),
        ErrorKind::Command(command) if command.code == 13 => "MongoDB denied permission. Check the database user's assigned roles in Atlas.".into(),
        ErrorKind::ServerSelection { .. } => "MongoDB could not reach an available server. In Atlas, confirm the cluster is active and your current IP is in Network Access. Also check your firewall, VPN, and TLS settings.".into(),
        ErrorKind::InvalidTlsConfig { .. } => "MongoDB could not configure TLS. Check your certificate settings; Atlas requires TLS.".into(),
        ErrorKind::Io(_) => "MongoDB encountered a network or TLS error. Check your network, firewall, VPN, and trusted certificates.".into(),
        _ => "MongoDB could not complete the connection check. Confirm the cluster is active and try again.".into(),
    }
}

pub(crate) async fn open(connection_string: &str) -> Result<(Client, String), String> {
    if !connection_string.starts_with("mongodb://")
        && !connection_string.starts_with("mongodb+srv://")
    {
        return Err("Use a connection string starting with mongodb:// or mongodb+srv://.".into());
    }

    // Syntax validation is separate from SRV/TXT discovery, which performs DNS I/O.
    let parsed = ConnectionString::parse(connection_string).map_err(connection_error)?;
    let database = parsed.default_database.clone()
        .ok_or_else(|| "Include a database name in your URI, for example mongodb://localhost:27017/my_database.".to_string())?;
    let is_atlas = matches!(
        &parsed.host_info,
        HostInfo::DnsRecord(host) if host.to_ascii_lowercase().ends_with(".mongodb.net")
    );
    let mut options = tokio::time::timeout(Duration::from_secs(10), async {
        match ClientOptions::parse(parsed.clone()).await {
            Err(error) if is_atlas && matches!(
                error.kind.as_ref(),
                ErrorKind::DnsResolve { message, .. }
                    if message.contains("failed to parse nameserver address")
            ) => {
                // Hickory's macOS loader can reject a system nameserver address before
                // sending any DNS query. Retry Atlas discovery with explicit nameservers.
                // The driver retains this resolver for subsequent SRV polling as well.
                ClientOptions::parse(parsed)
                    .resolver_config(ResolverConfig::cloudflare())
                    .await
            }
            result => result,
        }
    })
    .await
    .map_err(|_| "MongoDB DNS discovery timed out before login. Check your DNS or VPN settings, or use the standard mongodb:// URI supplied by Atlas.".to_string())?
    .map_err(connection_error)?;
    options.app_name = Some("Sapienta".into());
    options.connect_timeout = Some(Duration::from_secs(10));
    options.server_selection_timeout = Some(Duration::from_secs(10));
    options.max_pool_size = Some(1);
    options.min_pool_size = Some(0);

    let client = Client::with_options(options).map_err(connection_error)?;
    Ok((client, database))
}

pub async fn connect(connection_string: &str) -> Result<String, String> {
    let (client, database) = open(connection_string).await?;
    let response = client
        .database(&database)
        .run_command(doc! { "ping": 1 })
        .await;
    // Dropping the client cleans up in the background. Awaiting shutdown can hang
    // after a successful ping and turn a working connection into a timeout.
    drop(client);
    response.map_err(connection_error)?;
    Ok(database)
}
