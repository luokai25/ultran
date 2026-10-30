"""Catalog extension: real, publicly documented services beyond the core set.

Each line is ``id|Name|category|auth_kind|tier|action,action|description``.

Rules for adding a line (enforced by ``tests/test_connectors.py``):

* the service must exist and expose a public API or documented local interface;
* ``auth_kind`` is how Ultran authenticates (``api_key`` covers tokens and basic
  auth, ``oauth2`` needs a consent flow, ``webhook`` is an incoming URL,
  ``none`` is open or local);
* ``tier`` is ``free`` when the provider offers a usable free plan or the API is
  open, ``paid`` when an account on a paid plan is required.

Auth kind and tier reflect the providers' public documentation at the time of
writing. Providers change plans; treat them as the starting point shown in the
marketplace, not a billing guarantee.

Nothing here performs network I/O.
"""

from __future__ import annotations

_RAW = """
# ---- devtools ----
azure-devops|Azure DevOps|devtools|oauth2|free|list_repos,get_file,queue_build|Repos, boards and pipelines from Microsoft.
sourcehut|SourceHut|devtools|api_key|paid|list_repos,get_file|Minimalist hosted git and build service.
circleci|CircleCI|devtools|api_key|free|list_pipelines,trigger_pipeline|Hosted continuous integration.
jenkins|Jenkins|devtools|api_key|free|list_jobs,build_job|Self-hosted automation server.
buildkite|Buildkite|devtools|api_key|free|list_builds,create_build|CI that runs on your own agents.
drone-ci|Drone CI|devtools|api_key|free|list_builds,promote_build|Container-native self-hosted CI.
npm-registry|npm Registry|devtools|api_key|free|get_package,search,list_versions|JavaScript package registry.
pypi|PyPI|devtools|api_key|free|get_project,list_releases|Python package index.
crates-io|crates.io|devtools|api_key|free|get_crate,search|Rust package registry.
sonarcloud|SonarCloud|devtools|api_key|free|list_issues,get_quality_gate|Static analysis and code quality.
snyk|Snyk|devtools|api_key|free|list_issues,list_projects|Dependency and code vulnerability scanning.
codecov|Codecov|devtools|api_key|free|get_coverage,list_commits|Test coverage reporting.
postman|Postman|devtools|api_key|free|list_collections,run_collection|API collections and monitors.
codesandbox|CodeSandbox|devtools|api_key|free|list_sandboxes,create_sandbox|Cloud development sandboxes.
ngrok|ngrok|devtools|api_key|free|list_tunnels,create_endpoint|Secure tunnels to local services.
launchdarkly|LaunchDarkly|devtools|api_key|paid|list_flags,toggle_flag|Feature flag management.
posthog|PostHog|devtools|api_key|free|capture,query,list_flags|Product analytics and feature flags.
rollbar|Rollbar|devtools|api_key|free|list_items,get_occurrence|Real-time error tracking.
bugsnag|Bugsnag|devtools|api_key|free|list_errors,get_error|Application stability monitoring.
honeybadger|Honeybadger|devtools|api_key|free|list_faults,get_fault|Error and uptime monitoring.
new-relic|New Relic|devtools|api_key|free|run_nrql,list_applications|Full-stack observability.
elastic-cloud|Elastic Cloud|devtools|api_key|free|search,index_document|Hosted Elasticsearch and Kibana.
betterstack|Better Stack|devtools|api_key|free|list_monitors,create_incident|Uptime monitoring and log management.
uptimerobot|UptimeRobot|devtools|api_key|free|list_monitors,create_monitor|Website uptime checks.
healthchecks-io|Healthchecks.io|devtools|api_key|free|list_checks,ping_check|Cron job and heartbeat monitoring.
opsgenie|Opsgenie|devtools|api_key|paid|create_alert,close_alert|Alerting and on-call schedules.
statuspage|Statuspage|devtools|api_key|paid|create_incident,update_component|Public status pages.
# ---- databases ----
mysql|MySQL|data|api_key|free|query,execute|Direct SQL against a MySQL server.
sqlite|SQLite|data|none|free|query,execute|Local file database, no server.
clickhouse|ClickHouse|data|api_key|free|query,insert|Column-store analytics database.
snowflake|Snowflake|data|api_key|paid|run_query,list_warehouses|Cloud data warehouse.
databricks|Databricks|data|api_key|paid|run_sql,list_jobs|Lakehouse analytics platform.
bigquery|Google BigQuery|data|oauth2|free|run_query,list_datasets|Serverless data warehouse.
elasticsearch|Elasticsearch|data|api_key|free|search,index_document|Self-hosted search and analytics engine.
opensearch|OpenSearch|data|api_key|free|search,index_document|Open-source search suite.
meilisearch|Meilisearch|data|api_key|free|search,add_documents|Fast typo-tolerant search engine.
typesense|Typesense|data|api_key|free|search,upsert_document|Open-source search engine.
algolia|Algolia|data|api_key|free|search,save_object|Hosted search API.
influxdb|InfluxDB|data|api_key|free|query,write_points|Time-series database.
timescaledb|TimescaleDB|data|api_key|free|query,execute|Time-series on PostgreSQL.
neo4j|Neo4j|data|api_key|free|run_cypher,list_labels|Graph database.
planetscale|PlanetScale|data|api_key|paid|query,list_branches|Managed MySQL-compatible database.
neon|Neon|data|api_key|free|query,list_branches|Serverless PostgreSQL.
turso|Turso|data|api_key|free|query,execute|Edge SQLite database.
cockroachdb|CockroachDB|data|api_key|free|query,list_clusters|Distributed SQL database.
upstash|Upstash|data|api_key|free|redis_command,publish|Serverless Redis and Kafka.
firebase-firestore|Firebase Firestore|data|oauth2|free|get_document,set_document,query|Document database from Google.
appwrite|Appwrite|data|api_key|free|list_documents,create_document|Open-source backend platform.
pocketbase|PocketBase|data|api_key|free|list_records,create_record|Single-file self-hosted backend.
baserow|Baserow|data|api_key|free|list_rows,create_row|Open-source no-code database.
nocodb|NocoDB|data|api_key|free|list_records,create_record|Open-source spreadsheet database.
weaviate|Weaviate|data|api_key|free|upsert,query|Open-source vector database.
chroma|Chroma|data|none|free|add,query|Local-first embedding database.
milvus|Milvus|data|api_key|free|insert,search|Open-source vector database.
duckdb|DuckDB|data|none|free|query,load_csv|Embedded analytical database.
# ---- infra ----
aws-lambda|AWS Lambda|infra|api_key|paid|invoke,list_functions|Serverless functions on AWS.
aws-dynamodb|Amazon DynamoDB|infra|api_key|paid|get_item,put_item,query|Managed key-value store.
aws-sqs|Amazon SQS|infra|api_key|paid|send_message,receive_message|Managed message queues.
aws-sns|Amazon SNS|infra|api_key|paid|publish,list_topics|Pub/sub notifications.
gcp-storage|Google Cloud Storage|infra|oauth2|paid|upload_object,list_objects|Object storage on Google Cloud.
azure-blob|Azure Blob Storage|infra|api_key|paid|upload_blob,list_blobs|Object storage on Azure.
digitalocean|DigitalOcean|infra|api_key|paid|list_droplets,create_droplet|Virtual servers and managed services.
linode|Linode (Akamai)|infra|api_key|paid|list_instances,create_instance|Cloud compute.
hetzner-cloud|Hetzner Cloud|infra|api_key|paid|list_servers,create_server|Low-cost European cloud servers.
vultr|Vultr|infra|api_key|paid|list_instances,create_instance|Global cloud compute.
scaleway|Scaleway|infra|api_key|paid|list_servers,create_server|European cloud provider.
backblaze-b2|Backblaze B2|infra|api_key|free|upload_file,list_files|Low-cost object storage.
wasabi|Wasabi|infra|api_key|paid|put_object,list_objects|S3-compatible hot storage.
minio|MinIO|infra|api_key|free|put_object,list_objects|Self-hosted S3-compatible storage.
cloudflare-r2|Cloudflare R2|infra|api_key|free|put_object,list_objects|Object storage with no egress fees.
cloudflare-workers|Cloudflare Workers|infra|api_key|free|deploy_script,list_scripts|Edge compute.
railway|Railway|infra|api_key|paid|list_projects,deploy_service|App hosting platform.
heroku|Heroku|infra|api_key|paid|list_apps,restart_dyno|Platform as a service.
deno-deploy|Deno Deploy|infra|api_key|free|list_projects,create_deployment|Edge JavaScript hosting.
fastly|Fastly|infra|api_key|paid|purge_url,list_services|Edge cloud and CDN.
bunny-net|bunny.net|infra|api_key|paid|purge_url,list_pull_zones|CDN and storage.
kubernetes|Kubernetes|infra|api_key|free|list_pods,apply_manifest|Cluster API for container workloads.
terraform-cloud|Terraform Cloud|infra|api_key|free|list_workspaces,create_run|Infrastructure-as-code runs.
portainer|Portainer|infra|api_key|free|list_containers,restart_container|Container management UI.
tailscale|Tailscale|infra|api_key|free|list_devices,authorize_device|Private mesh network.
syncthing|Syncthing|infra|api_key|free|list_folders,get_status|Peer-to-peer file sync, local REST.
rabbitmq|RabbitMQ|infra|api_key|free|publish,list_queues|Message broker.
nats|NATS|infra|none|free|publish,request|Lightweight messaging.
mqtt|MQTT Broker|infra|none|free|publish,subscribe|Publish/subscribe for devices.
# ---- security / identity ----
hashicorp-vault|HashiCorp Vault|security|api_key|free|read_secret,write_secret|Secrets management.
onepassword|1Password|security|api_key|paid|get_item,list_vaults|Password manager with a Connect server.
bitwarden|Bitwarden|security|api_key|free|list_items,get_item|Open-source password manager.
doppler|Doppler|security|api_key|free|get_secrets,set_secret|Secrets across environments.
infisical|Infisical|security|api_key|free|get_secret,create_secret|Open-source secrets platform.
auth0|Auth0|security|api_key|free|list_users,create_user|Identity and access management.
okta|Okta|security|api_key|paid|list_users,deactivate_user|Workforce identity.
clerk|Clerk|security|api_key|free|list_users,create_user|User management for apps.
keycloak|Keycloak|security|api_key|free|list_users,create_user|Self-hosted identity server.
stytch|Stytch|security|api_key|free|create_user,send_otp|Passwordless authentication.
workos|WorkOS|security|api_key|free|list_connections,create_organization|Enterprise SSO and directory sync.
virustotal|VirusTotal|security|api_key|free|scan_url,get_file_report|File and URL reputation.
have-i-been-pwned|Have I Been Pwned|security|api_key|paid|check_breaches,check_password|Breach lookups.
shodan|Shodan|security|api_key|free|host_lookup,search|Internet-exposed device search.
abuseipdb|AbuseIPDB|security|api_key|free|check_ip,report_ip|IP reputation database.
cloudflare-turnstile|Cloudflare Turnstile|security|api_key|free|verify_token|Privacy-friendly captcha verification.
recaptcha|reCAPTCHA|security|api_key|free|verify_token|Bot detection from Google.
# ---- communication ----
mattermost|Mattermost|communication|webhook|free|post_message,list_channels|Self-hosted team chat.
rocket-chat|Rocket.Chat|communication|api_key|free|post_message,list_channels|Open-source team chat.
zulip|Zulip|communication|api_key|free|send_message,list_streams|Threaded team chat.
matrix|Matrix|communication|api_key|free|send_message,list_rooms|Open federated messaging.
line-messaging|LINE Messaging API|communication|api_key|free|push_message,reply_message|Bot messaging on LINE.
viber|Viber Bots|communication|api_key|free|send_message,set_webhook|Bot messaging on Viber.
messagebird|MessageBird|communication|api_key|paid|send_sms,send_whatsapp|Omnichannel messaging.
vonage|Vonage|communication|api_key|paid|send_sms,start_verify|SMS, voice and verification.
plivo|Plivo|communication|api_key|paid|send_sms,make_call|Programmable SMS and voice.
sinch|Sinch|communication|api_key|paid|send_sms,send_batch|Messaging and voice APIs.
postmark|Postmark|communication|api_key|paid|send_email,list_templates|Transactional email.
mailgun|Mailgun|communication|api_key|free|send_email,list_events|Email delivery API.
sparkpost|SparkPost|communication|api_key|paid|send_email,list_templates|High-volume email delivery.
brevo|Brevo|communication|api_key|free|send_email,add_contact|Email and SMS marketing.
mailjet|Mailjet|communication|api_key|free|send_email,list_contacts|Email delivery and campaigns.
zoom|Zoom|communication|oauth2|free|create_meeting,list_recordings|Video meetings.
webex|Webex|communication|oauth2|free|create_meeting,post_message|Cisco meetings and messaging.
ringcentral|RingCentral|communication|oauth2|paid|send_sms,list_calls|Cloud phone and messaging.
twitch-chat|Twitch Chat|communication|oauth2|free|send_chat,list_followers|Live stream chat.
pushover|Pushover|communication|api_key|paid|send_notification|Push notifications to devices.
ntfy|ntfy|communication|none|free|publish,subscribe|Simple pub-sub notifications.
gotify|Gotify|communication|api_key|free|send_message,list_messages|Self-hosted push server.
pushbullet|Pushbullet|communication|api_key|free|push_note,list_devices|Push between devices.
onesignal|OneSignal|communication|api_key|free|send_notification,list_players|Push and in-app messaging.
firebase-cloud-messaging|Firebase Cloud Messaging|communication|oauth2|free|send_message,subscribe_topic|Push delivery for Android and web.
expo-push|Expo Push|communication|none|free|send_push,get_receipts|Push for Expo apps.
# ---- support ----
intercom|Intercom|support|oauth2|paid|list_conversations,reply|Customer messaging.
zendesk|Zendesk|support|api_key|paid|list_tickets,create_ticket|Customer support platform.
freshdesk|Freshdesk|support|api_key|free|list_tickets,create_ticket|Helpdesk software.
helpscout|Help Scout|support|oauth2|paid|list_conversations,create_conversation|Shared inbox and help desk.
crisp|Crisp|support|api_key|free|list_conversations,send_message|Live chat and inbox.
front|Front|support|api_key|paid|list_conversations,send_reply|Shared inbox for teams.
freshservice|Freshservice|support|api_key|paid|list_tickets,create_ticket|IT service management.
statuscake|StatusCake|support|api_key|free|list_tests,create_test|Website and page speed monitoring.
# ---- productivity ----
coda|Coda|productivity|api_key|free|list_docs,insert_rows|Docs that work like apps.
evernote|Evernote|productivity|oauth2|free|create_note,search_notes|Note taking.
onenote|OneNote|productivity|oauth2|free|list_notebooks,create_page|Microsoft note taking.
microsoft-todo|Microsoft To Do|productivity|oauth2|free|list_tasks,create_task|Personal task lists.
onedrive|OneDrive|productivity|oauth2|free|list_files,upload|Microsoft cloud storage.
sharepoint|SharePoint|productivity|oauth2|paid|list_sites,upload_file|Microsoft intranet and documents.
box|Box|productivity|oauth2|free|list_files,upload,create_shared_link|Enterprise file storage.
nextcloud|Nextcloud|productivity|api_key|free|list_files,upload|Self-hosted file sync.
confluence|Confluence|productivity|api_key|free|search,create_page|Atlassian wiki.
monday|monday.com|productivity|api_key|free|list_items,create_item|Work management boards.
wrike|Wrike|productivity|oauth2|free|list_tasks,create_task|Project management.
basecamp|Basecamp|productivity|oauth2|paid|list_projects,create_todo|Project communication.
smartsheet|Smartsheet|productivity|api_key|paid|list_sheets,add_rows|Spreadsheet-style work management.
typeform|Typeform|productivity|api_key|free|list_forms,get_responses|Conversational forms.
jotform|Jotform|productivity|api_key|free|list_forms,get_submissions|Online form builder.
tally|Tally|productivity|api_key|free|list_forms,get_submissions|Free form builder.
google-forms|Google Forms|productivity|oauth2|free|get_form,list_responses|Surveys and quizzes.
google-tasks|Google Tasks|productivity|oauth2|free|list_tasks,create_task|Simple task lists.
google-slides|Google Slides|productivity|oauth2|free|create_presentation,append_slide|Presentations.
google-contacts|Google Contacts|productivity|oauth2|free|list_contacts,create_contact|Address book.
zoho-crm|Zoho CRM|productivity|oauth2|free|list_records,create_record|Customer relationship management.
zoho-mail|Zoho Mail|productivity|oauth2|free|list_messages,send_email|Business email.
toggl-track|Toggl Track|productivity|api_key|free|list_entries,start_timer|Time tracking.
clockify|Clockify|productivity|api_key|free|list_entries,start_timer|Free time tracker.
harvest|Harvest|productivity|oauth2|paid|list_entries,create_entry|Time and invoicing.
zapier-webhooks|Zapier Webhooks|productivity|webhook|free|catch_hook,trigger_zap|Trigger Zaps from a URL.
make-webhooks|Make Webhooks|productivity|webhook|free|trigger_scenario|Trigger Make scenarios.
ifttt-webhooks|IFTTT Webhooks|productivity|webhook|free|trigger_event|Trigger applets with an event.
n8n|n8n|productivity|api_key|free|list_workflows,run_workflow|Self-hostable workflow automation.
pipedream|Pipedream|productivity|api_key|free|trigger_workflow,list_sources|Event-driven workflows.
cal-com|Cal.com|productivity|api_key|free|list_bookings,create_booking|Open scheduling infrastructure.
readwise|Readwise|productivity|api_key|paid|list_highlights,add_highlight|Highlights and reading queue.
raindrop-io|Raindrop.io|productivity|oauth2|free|list_bookmarks,create_bookmark|Bookmark manager.
obsidian-local-rest|Obsidian Local REST|productivity|api_key|free|read_note,write_note,search|Local vault access via a community plugin.
anki-connect|AnkiConnect|productivity|none|free|add_note,find_cards|Local flashcard automation via add-on.
logseq-local|Logseq Local API|productivity|api_key|free|get_page,insert_block|Local graph access.
miro|Miro|productivity|oauth2|free|list_boards,create_sticky|Online whiteboards.
figma|Figma|productivity|api_key|free|get_file,list_comments|Design files and comments.
canva|Canva|productivity|oauth2|free|list_designs,create_design|Design platform.
lucidchart|Lucidchart|productivity|oauth2|free|list_documents,get_document|Diagrams.
# ---- commerce ----
square|Square|commerce|oauth2|paid|create_payment,list_orders|Payments and point of sale.
woocommerce|WooCommerce|commerce|api_key|free|list_products,create_order|WordPress storefront.
bigcommerce|BigCommerce|commerce|api_key|paid|list_products,create_order|Hosted commerce.
etsy|Etsy|commerce|oauth2|free|list_listings,get_receipts|Marketplace shop API.
ebay|eBay|commerce|oauth2|free|search_items,create_listing|Marketplace listings.
adyen|Adyen|commerce|api_key|paid|create_session,capture|Global payments.
braintree|Braintree|commerce|api_key|paid|create_transaction,find_customer|PayPal payments gateway.
razorpay|Razorpay|commerce|api_key|paid|create_order,fetch_payment|Payments in India.
mollie|Mollie|commerce|api_key|paid|create_payment,list_payments|European payments.
klarna|Klarna|commerce|api_key|paid|create_session,capture_order|Buy now pay later.
coinbase-commerce|Coinbase Commerce|commerce|api_key|free|create_charge,list_charges|Accept crypto payments.
chargebee|Chargebee|commerce|api_key|paid|create_subscription,list_invoices|Subscription billing.
recurly|Recurly|commerce|api_key|paid|list_subscriptions,create_account|Subscription management.
quickbooks|QuickBooks|commerce|oauth2|paid|create_invoice,list_customers|Accounting.
xero|Xero|commerce|oauth2|paid|create_invoice,list_contacts|Accounting.
freshbooks|FreshBooks|commerce|oauth2|paid|create_invoice,list_clients|Invoicing and accounting.
plaid|Plaid|commerce|api_key|free|link_token,get_transactions|Bank account connectivity.
wise|Wise|commerce|api_key|free|get_quote,create_transfer|International transfers.
gocardless|GoCardless|commerce|api_key|paid|create_mandate,create_payment|Direct debit payments.
paystack|Paystack|commerce|api_key|paid|initialize_transaction,verify_transaction|Payments in Africa.
flutterwave|Flutterwave|commerce|api_key|paid|create_payment,verify_transaction|Payments across Africa.
mercadopago|Mercado Pago|commerce|api_key|paid|create_preference,get_payment|Payments in Latin America.
shippo|Shippo|commerce|api_key|free|create_shipment,get_rates|Shipping labels and tracking.
easypost|EasyPost|commerce|api_key|free|create_shipment,track|Shipping API.
shipstation|ShipStation|commerce|api_key|paid|list_orders,create_label|Order fulfilment.
printful|Printful|commerce|api_key|free|list_products,create_order|Print on demand.
printify|Printify|commerce|api_key|free|list_products,create_order|Print on demand marketplace.
snipcart|Snipcart|commerce|api_key|paid|list_orders,get_order|Cart for static sites.
# ---- finance / market data ----
alpha-vantage|Alpha Vantage|finance|api_key|free|time_series,quote,search|Stock and forex data.
polygon-io|Polygon.io|finance|api_key|free|aggregates,last_trade|Market data.
finnhub|Finnhub|finance|api_key|free|quote,company_news|Real-time stock data.
twelve-data|Twelve Data|finance|api_key|free|time_series,quote|Market data API.
coingecko|CoinGecko|finance|api_key|free|price,market_chart,list_coins|Crypto prices.
coinmarketcap|CoinMarketCap|finance|api_key|free|latest_listings,quotes|Crypto market data.
binance|Binance|finance|api_key|free|ticker,place_order|Crypto exchange.
coinbase|Coinbase|finance|oauth2|free|list_accounts,get_price|Crypto exchange and wallet.
kraken|Kraken|finance|api_key|free|ticker,add_order|Crypto exchange.
exchangerate-api|ExchangeRate-API|finance|api_key|free|latest,convert|Currency conversion rates.
openexchangerates|Open Exchange Rates|finance|api_key|free|latest,historical|Currency data.
frankfurter|Frankfurter|finance|none|free|latest,historical|Open ECB exchange rates.
fred|FRED|finance|api_key|free|get_series,search_series|US economic data.
world-bank|World Bank Data|finance|none|free|get_indicator,list_countries|Open development indicators.
sec-edgar|SEC EDGAR|finance|none|free|get_filings,get_company_facts|US company filings.
# ---- crm / sales ----
salesforce|Salesforce|crm|oauth2|paid|query,create_record|Enterprise CRM.
pipedrive|Pipedrive|crm|api_key|paid|list_deals,create_deal|Sales pipeline CRM.
freshsales|Freshsales|crm|api_key|free|list_contacts,create_deal|Sales CRM.
close-crm|Close|crm|api_key|paid|list_leads,create_lead|Inside sales CRM.
copper|Copper|crm|api_key|paid|list_people,create_opportunity|CRM for Google Workspace.
attio|Attio|crm|api_key|free|list_records,create_record|Flexible CRM.
insightly|Insightly|crm|api_key|free|list_contacts,create_lead|CRM and project management.
apollo-io|Apollo.io|crm|api_key|free|search_people,enrich_organization|Sales intelligence.
hunter-io|Hunter|crm|api_key|free|domain_search,verify_email|Email finding and verification.
lemlist|lemlist|crm|api_key|paid|list_campaigns,add_lead|Cold email outreach.
docusign|DocuSign|crm|oauth2|paid|send_envelope,get_envelope|Electronic signatures.
pandadoc|PandaDoc|crm|api_key|free|create_document,send_document|Proposals and e-signature.
dropbox-sign|Dropbox Sign|crm|api_key|free|send_request,get_request|Electronic signatures.
yousign|Yousign|crm|api_key|paid|create_request,get_request|European e-signature.
# ---- social / marketing ----
facebook-graph|Facebook Graph|social|oauth2|free|publish_post,list_pages|Pages and posts.
tiktok|TikTok|social|oauth2|free|publish_video,get_user_info|Content posting.
pinterest|Pinterest|social|oauth2|free|create_pin,list_boards|Pins and boards.
tumblr|Tumblr|social|oauth2|free|create_post,get_blog_info|Blog posting.
mastodon|Mastodon|social|oauth2|free|post_status,search|Federated microblogging.
bluesky|Bluesky|social|api_key|free|create_post,get_timeline|AT Protocol social network.
threads|Threads|social|oauth2|free|publish_thread,get_insights|Meta text network.
wordpress|WordPress|social|api_key|free|create_post,list_posts|Publishing via REST.
ghost-cms|Ghost|social|api_key|free|create_post,list_posts|Publishing and newsletters.
buttondown|Buttondown|social|api_key|free|send_email,list_subscribers|Newsletters.
beehiiv|beehiiv|social|api_key|free|create_post,list_subscribers|Newsletter platform.
kit|Kit (ConvertKit)|social|api_key|free|add_subscriber,list_broadcasts|Creator email marketing.
klaviyo|Klaviyo|social|api_key|free|track_event,list_profiles|Marketing automation.
activecampaign|ActiveCampaign|social|api_key|paid|create_contact,add_to_list|Marketing and CRM.
getresponse|GetResponse|social|api_key|paid|add_contact,send_newsletter|Email marketing.
constant-contact|Constant Contact|social|oauth2|paid|list_contacts,create_campaign|Email marketing.
customer-io|Customer.io|social|api_key|paid|identify,track|Behavior-driven messaging.
braze|Braze|social|api_key|paid|track_users,send_message|Customer engagement.
# ---- analytics ----
mixpanel|Mixpanel|analytics|api_key|free|track,query|Product analytics.
amplitude|Amplitude|analytics|api_key|free|track,query|Product analytics.
segment|Segment|analytics|api_key|free|track,identify|Customer data pipeline.
google-analytics|Google Analytics|analytics|oauth2|free|run_report,list_properties|Web analytics (GA4).
plausible|Plausible|analytics|api_key|paid|get_stats,get_breakdown|Privacy-friendly analytics.
fathom|Fathom Analytics|analytics|api_key|paid|get_aggregation,list_sites|Privacy-friendly analytics.
matomo|Matomo|analytics|api_key|free|get_visits,track_event|Self-hostable analytics.
hotjar|Hotjar|analytics|oauth2|free|list_surveys,get_responses|Heatmaps and feedback.
heap|Heap|analytics|api_key|free|track,identify|Autocapture analytics.
fullstory|FullStory|analytics|api_key|paid|list_sessions,get_session|Session replay.
google-search-console|Google Search Console|analytics|oauth2|free|query_analytics,list_sitemaps|Search performance.
umami|Umami|analytics|api_key|free|get_stats,get_pageviews|Open-source analytics.
# ---- content / cms ----
contentful|Contentful|content|api_key|free|get_entries,create_entry|Headless CMS.
sanity|Sanity|content|api_key|free|query,create_document|Structured content platform.
strapi|Strapi|content|api_key|free|list_entries,create_entry|Open-source headless CMS.
storyblok|Storyblok|content|api_key|free|get_stories,create_story|Visual headless CMS.
prismic|Prismic|content|api_key|free|query,get_document|Headless website builder.
hygraph|Hygraph|content|api_key|free|query,mutate|GraphQL content platform.
webflow|Webflow|content|api_key|free|list_sites,create_item|Visual site builder CMS.
squarespace|Squarespace|content|oauth2|paid|list_products,list_orders|Site builder commerce API.
wix|Wix|content|oauth2|free|list_items,create_item|Site platform.
directus|Directus|content|api_key|free|list_items,create_item|Open-source data platform.
payload-cms|Payload CMS|content|api_key|free|find,create|Code-first headless CMS.
# ---- model providers ----
google-ai-studio|Google AI Studio|ai|api_key|free|chat_completion,list_models|Gemini API through Google AI Studio.
cerebras|Cerebras|ai|api_key|free|chat_completion,list_models|High-speed inference API.
# ---- ai ----
groq|Groq|ai|api_key|free|chat_completion,transcribe|Fast LLM inference.
mistral|Mistral AI|ai|api_key|free|chat_completion,embed|Hosted open-weight and frontier models.
cohere|Cohere|ai|api_key|free|chat,embed,rerank|Language models for enterprise.
together-ai|Together AI|ai|api_key|paid|chat_completion,embed|Hosted open models.
fireworks-ai|Fireworks AI|ai|api_key|paid|chat_completion,embed|Fast open-model inference.
perplexity|Perplexity|ai|api_key|paid|chat_completion|Search-grounded answers.
deepseek|DeepSeek|ai|api_key|paid|chat_completion|Reasoning and chat models.
xai|xAI|ai|api_key|paid|chat_completion|Grok models.
google-gemini|Google Gemini|ai|api_key|free|generate_content,embed|Gemini models.
openrouter|OpenRouter|ai|api_key|free|chat_completion,list_models|One API for many models.
azure-openai|Azure OpenAI|ai|api_key|paid|chat_completion,embed|OpenAI models on Azure.
aws-bedrock|Amazon Bedrock|ai|api_key|paid|invoke_model,list_models|Foundation models on AWS.
stability-ai|Stability AI|ai|api_key|paid|text_to_image,upscale|Image generation.
leonardo-ai|Leonardo.Ai|ai|api_key|free|generate_image,list_models|Image generation.
runway|Runway|ai|api_key|paid|text_to_video,get_task|Video generation.
assemblyai|AssemblyAI|ai|api_key|free|transcribe,get_transcript|Speech to text.
deepgram|Deepgram|ai|api_key|free|transcribe,speak|Speech recognition and synthesis.
lm-studio|LM Studio|ai|none|free|chat_completion,list_models|Local OpenAI-compatible server.
llama-cpp-server|llama.cpp Server|ai|none|free|chat_completion,embed|Local inference server.
vllm|vLLM|ai|none|free|chat_completion,list_models|Self-hosted high-throughput serving.
langfuse|Langfuse|ai|api_key|free|log_trace,list_traces|LLM observability.
weights-and-biases|Weights & Biases|ai|api_key|free|log_run,list_runs|Experiment tracking.
roboflow|Roboflow|ai|api_key|free|infer,list_projects|Computer vision.
deepl|DeepL|ai|api_key|free|translate,list_languages|Machine translation.
google-translate|Google Translate|ai|api_key|free|translate,detect_language|Machine translation.
libretranslate|LibreTranslate|ai|none|free|translate,detect|Self-hosted translation.
whisper-cpp|whisper.cpp Server|ai|none|free|transcribe|Local offline speech to text.
comfyui|ComfyUI|ai|none|free|queue_prompt,get_history|Local node-based image generation.
automatic1111|Stable Diffusion WebUI|ai|none|free|txt2img,img2img|Local image generation API.
# ---- research ----
wikipedia|Wikipedia|research|none|free|search,get_summary|Encyclopedia articles.
wikidata|Wikidata|research|none|free|search_entities,run_sparql|Structured knowledge base.
openalex|OpenAlex|research|none|free|search_works,get_author|Open scholarly index.
crossref|Crossref|research|none|free|get_work,search_works|DOI metadata.
semantic-scholar|Semantic Scholar|research|api_key|free|search_papers,get_paper|Paper search and citations.
pubmed|PubMed|research|none|free|search,fetch_abstract|Biomedical literature.
core-ac-uk|CORE|research|api_key|free|search_works,get_work|Open access research papers.
hacker-news|Hacker News|research|none|free|top_stories,get_item|Tech news firebase API.
stack-exchange|Stack Exchange|research|api_key|free|search_questions,get_answers|Q&A across sites.
wayback-machine|Wayback Machine|research|none|free|get_snapshot,save_page|Web archive.
brave-search|Brave Search|research|api_key|free|web_search,news_search|Independent search index.
bing-search|Bing Search|research|api_key|paid|web_search,image_search|Microsoft web search.
tavily|Tavily|research|api_key|free|search,extract|Search built for agents.
exa|Exa|research|api_key|free|search,get_contents|Neural web search.
firecrawl|Firecrawl|research|api_key|free|scrape,crawl|Web to markdown.
browserless|Browserless|research|api_key|free|screenshot,content|Hosted headless browsers.
apify|Apify|research|api_key|free|run_actor,get_dataset|Web scraping platform.
scrapingbee|ScrapingBee|research|api_key|free|fetch_page,screenshot|Scraping API.
serper|Serper|research|api_key|free|search,images|Google search API.
google-custom-search|Google Custom Search|research|api_key|free|search|Programmable search.
jina-reader|Jina Reader|research|none|free|read_url,search|Turn URLs into clean text.
internet-archive|Internet Archive|research|none|free|search_items,get_metadata|Books, media and web history.
open-library|Open Library|research|none|free|search_books,get_edition|Book metadata.
project-gutenberg|Project Gutenberg|research|none|free|search_books,get_text|Public domain books.
nasa-open|NASA Open APIs|research|api_key|free|apod,search_images|Space imagery and data.
usgs-earthquakes|USGS Earthquakes|research|none|free|recent_events,query_events|Seismic event feeds.
# ---- geo / weather ----
google-maps|Google Maps Platform|geo|api_key|paid|geocode,directions,places_search|Maps, places and routes.
mapbox|Mapbox|geo|api_key|free|geocode,directions|Maps and routing.
here-maps|HERE|geo|api_key|free|geocode,route|Location platform.
tomtom|TomTom|geo|api_key|free|search,route|Maps and traffic.
opencage|OpenCage|geo|api_key|free|geocode,reverse_geocode|Geocoding.
geonames|GeoNames|geo|api_key|free|search,find_nearby|Geographical database.
nominatim|OpenStreetMap Nominatim|geo|none|free|search,reverse|Open geocoding.
overpass|Overpass API|geo|none|free|query|Read OpenStreetMap data.
ipinfo|ipinfo.io|geo|api_key|free|lookup_ip|IP geolocation.
open-meteo|Open-Meteo|geo|none|free|forecast,historical|Open weather data.
openweathermap|OpenWeatherMap|geo|api_key|free|current,forecast|Weather data.
weatherapi|WeatherAPI|geo|api_key|free|current,forecast|Weather and astronomy.
opensky|OpenSky Network|geo|none|free|states,flights_by_aircraft|Live air traffic data.
flightaware|FlightAware AeroAPI|geo|api_key|paid|get_flight,list_airport_flights|Flight tracking.
amadeus|Amadeus|geo|api_key|free|search_flights,search_hotels|Travel search.
# ---- iot / home ----
home-assistant|Home Assistant|iot|api_key|free|call_service,get_states|Local home automation.
philips-hue|Philips Hue|iot|api_key|free|list_lights,set_light|Smart lights over the local bridge.
tuya|Tuya|iot|api_key|free|get_device,send_command|Smart device cloud.
smartthings|SmartThings|iot|oauth2|free|list_devices,execute_command|Samsung smart home.
zigbee2mqtt|Zigbee2MQTT|iot|none|free|list_devices,set_state|Local Zigbee bridge over MQTT.
esphome|ESPHome|iot|api_key|free|get_state,call_service|Firmware for ESP devices.
octoprint|OctoPrint|iot|api_key|free|get_job,start_print|3D printer control.
pi-hole|Pi-hole|iot|api_key|free|get_summary,disable_blocking|Network-wide ad blocking.
# ---- media ----
twitch|Twitch|media|oauth2|free|get_streams,get_clips|Live streaming metadata.
soundcloud|SoundCloud|media|oauth2|free|search_tracks,get_track|Audio platform.
lastfm|Last.fm|media|api_key|free|get_top_tracks,scrobble|Listening history.
musicbrainz|MusicBrainz|media|none|free|search_artist,get_release|Open music encyclopedia.
deezer|Deezer|media|none|free|search,get_track|Music catalog.
tmdb|TMDB|media|api_key|free|search_movies,get_details|Movie and TV metadata.
omdb|OMDb|media|api_key|free|search,get_title|Movie database.
trakt|Trakt|media|oauth2|free|get_history,search|TV and movie tracking.
steam-web|Steam Web API|media|api_key|free|get_owned_games,get_player|Game library data.
unsplash|Unsplash|media|api_key|free|search_photos,get_photo|Free photography.
pexels|Pexels|media|api_key|free|search_photos,search_videos|Free stock media.
pixabay|Pixabay|media|api_key|free|search_images,search_videos|Free stock media.
giphy|GIPHY|media|api_key|free|search,trending|Animated GIFs.
tenor|Tenor|media|api_key|free|search,trending|GIF search.
flickr|Flickr|media|api_key|free|search_photos,get_info|Photo sharing.
imgur|Imgur|media|api_key|free|upload_image,get_album|Image hosting.
shutterstock|Shutterstock|media|oauth2|paid|search_images,license_image|Stock media.
mux|Mux|media|api_key|paid|create_asset,get_asset|Video infrastructure.
cloudflare-stream|Cloudflare Stream|media|api_key|paid|upload_video,list_videos|Video delivery.
bunny-stream|Bunny Stream|media|api_key|paid|create_video,list_videos|Video hosting.
podcast-index|Podcast Index|media|api_key|free|search_podcasts,get_episodes|Open podcast directory.
listen-notes|Listen Notes|media|api_key|free|search,get_podcast|Podcast search.
genius|Genius|media|api_key|free|search,get_song|Song metadata and annotations.
# ---- health / fitness ----
fitbit|Fitbit|health|oauth2|free|get_activity,get_sleep|Activity and sleep data.
strava|Strava|health|oauth2|free|list_activities,get_activity|Workout tracking.
oura|Oura|health|oauth2|free|get_sleep,get_readiness|Ring sleep and readiness data.
withings|Withings|health|oauth2|free|get_measures,get_activity|Body and sleep metrics.
whoop|WHOOP|health|oauth2|free|get_recovery,get_workouts|Recovery and strain data.
openfda|openFDA|health|none|free|search_drugs,search_events|US drug and device data.
nutritionix|Nutritionix|health|api_key|free|search_foods,get_nutrients|Food and nutrition database.
open-food-facts|Open Food Facts|health|none|free|get_product,search|Open food product database.
# ---- education ----
canvas-lms|Canvas LMS|education|api_key|free|list_courses,list_assignments|Learning management.
moodle|Moodle|education|api_key|free|list_courses,get_grades|Open-source learning management.
google-classroom|Google Classroom|education|oauth2|free|list_courses,list_coursework|Classroom coursework.
"""


def _parse() -> tuple[tuple[str, str, str, str, str, tuple[str, ...], str], ...]:
    rows: list[tuple[str, str, str, str, str, tuple[str, ...], str]] = []
    for lineno, line in enumerate(_RAW.splitlines(), start=1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("|")
        if len(parts) != 7:  # pragma: no cover - guards against malformed rows
            raise RuntimeError(f"catalog_extra line {lineno}: expected 7 fields, got {len(parts)}: {line!r}")
        cid, name, category, auth_kind, tier, actions, description = (p.strip() for p in parts)
        rows.append((cid, name, category, auth_kind, tier, tuple(a for a in actions.split(",") if a), description))
    return tuple(rows)


EXTRA_ROWS = _parse()
