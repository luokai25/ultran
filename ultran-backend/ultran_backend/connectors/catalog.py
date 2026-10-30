"""The built-in connector catalog.

Every entry is a real, documented integration point. ``tier`` marks whether the
upstream provider can be used without a paid account (``free``) or requires one
(``paid``); ``auth_kind`` records how Ultran authenticates to it.

Nothing here performs network I/O - the catalog is the declarative half of a
connector. The runtime half is :mod:`ultran_backend.sandbox` + the ``/execute``
endpoint, which resolves a connector, checks the credential and applies the
policy gate before any call leaves the machine.
"""

from __future__ import annotations

from typing import Iterator

from .registry import ConnectorManifest

# (id, name, category, auth_kind, tier, actions, description)
_ROWS: tuple[tuple[str, str, str, str, str, tuple[str, ...], str], ...] = (
    # ---------------- source control ----------------
    ("github", "GitHub", "source-control", "oauth2", "free", ("list_repos", "get_file", "commit", "open_pr"), "Repositories, pull requests, Actions and releases."),
    ("gitlab", "GitLab", "source-control", "oauth2", "free", ("list_projects", "get_file", "commit", "open_mr"), "Self-hostable git with merge requests and CI."),
    ("bitbucket", "Bitbucket", "source-control", "oauth2", "free", ("list_repos", "get_file", "commit"), "Atlassian git hosting with Pipelines."),
    ("gitea", "Gitea", "source-control", "api_key", "free", ("list_repos", "get_file", "commit"), "Lightweight self-hosted git service."),
    # ---------------- communication ----------------
    ("slack", "Slack", "communication", "oauth2", "free", ("post_message", "list_channels", "upload_file"), "Team chat, channels and workflow webhooks."),
    ("discord", "Discord", "communication", "webhook", "free", ("post_message", "list_guilds"), "Community chat with bot and webhook access."),
    ("telegram", "Telegram", "communication", "api_key", "free", ("send_message", "get_updates"), "Bot API messaging for channels and chats."),
    ("microsoft-teams", "Microsoft Teams", "communication", "oauth2", "paid", ("post_message", "list_channels"), "Enterprise chat and meeting rooms."),
    ("whatsapp-cloud", "WhatsApp Cloud API", "communication", "api_key", "paid", ("send_message", "send_template"), "Meta Cloud API for WhatsApp Business."),
    ("twilio-sms", "Twilio SMS", "communication", "api_key", "paid", ("send_sms", "get_message"), "Programmable SMS and voice."),
    ("sendgrid", "SendGrid", "communication", "api_key", "free", ("send_email", "list_templates"), "Transactional email delivery."),
    ("ses", "Amazon SES", "communication", "api_key", "paid", ("send_email", "verify_domain"), "Bulk email on AWS."),
    ("resend", "Resend", "communication", "api_key", "free", ("send_email", "list_domains"), "Developer-first transactional email."),
    # ---------------- productivity / docs ----------------
    ("notion", "Notion", "productivity", "oauth2", "free", ("search", "create_page", "append_block", "query_database"), "Docs, wikis and structured databases."),
    ("google-drive", "Google Drive", "productivity", "oauth2", "free", ("list_files", "upload", "share"), "Cloud file storage and sharing."),
    ("google-docs", "Google Docs", "productivity", "oauth2", "free", ("create_document", "append_text"), "Collaborative documents."),
    ("google-sheets", "Google Sheets", "productivity", "oauth2", "free", ("read_range", "append_row", "update_cell"), "Spreadsheet read and write."),
    ("google-calendar", "Google Calendar", "productivity", "oauth2", "free", ("list_events", "create_event"), "Scheduling and availability."),
    ("gmail", "Gmail", "productivity", "oauth2", "free", ("list_messages", "send_email", "apply_label"), "Mailbox search, send and label."),
    ("outlook-mail", "Outlook Mail", "productivity", "oauth2", "paid", ("list_messages", "send_email"), "Microsoft 365 mailbox."),
    ("dropbox", "Dropbox", "productivity", "oauth2", "free", ("list_files", "upload", "share_link"), "File sync and sharing."),
    ("airtable", "Airtable", "productivity", "api_key", "free", ("list_records", "create_record", "update_record"), "Spreadsheet-database hybrid."),
    ("trello", "Trello", "productivity", "api_key", "free", ("list_boards", "create_card", "move_card"), "Kanban boards."),
    ("asana", "Asana", "productivity", "oauth2", "free", ("list_tasks", "create_task", "complete_task"), "Team task tracking."),
    ("linear", "Linear", "productivity", "api_key", "free", ("list_issues", "create_issue", "update_issue"), "Issue tracking for product teams."),
    ("jira", "Jira", "productivity", "api_key", "paid", ("list_issues", "create_issue", "transition_issue"), "Atlassian project tracking."),
    ("clickup", "ClickUp", "productivity", "api_key", "free", ("list_tasks", "create_task"), "All-in-one work management."),
    ("todoist", "Todoist", "productivity", "api_key", "free", ("list_tasks", "create_task", "complete_task"), "Personal task manager."),
    ("calendly", "Calendly", "productivity", "api_key", "free", ("list_event_types", "create_invite"), "Scheduling links and bookings."),
    # ---------------- commerce / payments ----------------
    ("stripe", "Stripe", "commerce", "api_key", "paid", ("create_charge", "list_customers", "create_checkout"), "Payments, subscriptions and billing."),
    ("lemonsqueezy", "Lemon Squeezy", "commerce", "api_key", "paid", ("create_checkout", "list_orders"), "Merchant of record for digital goods."),
    ("paddle", "Paddle", "commerce", "api_key", "paid", ("create_checkout", "list_transactions"), "Subscription billing and tax."),
    ("shopify", "Shopify", "commerce", "api_key", "paid", ("list_products", "create_product", "list_orders"), "Storefront products and orders."),
    ("gumroad", "Gumroad", "commerce", "api_key", "free", ("list_products", "create_product"), "Sell digital products direct."),
    ("paypal", "PayPal", "commerce", "oauth2", "paid", ("create_order", "capture_order"), "Global checkout and payouts."),
    # ---------------- social / marketing ----------------
    ("x-twitter", "X (Twitter)", "social", "oauth2", "paid", ("post_tweet", "search", "upload_media"), "Posting and search on X."),
    ("linkedin", "LinkedIn", "social", "oauth2", "paid", ("share_post", "list_organizations"), "Professional network publishing."),
    ("reddit", "Reddit", "social", "oauth2", "free", ("submit_post", "list_hot"), "Community posting and reading."),
    ("youtube-data", "YouTube Data", "social", "api_key", "free", ("search", "list_videos", "get_comments"), "Video metadata and comments."),
    ("instagram-graph", "Instagram Graph", "social", "oauth2", "paid", ("publish_media", "list_media"), "Business account publishing."),
    ("mailchimp", "Mailchimp", "social", "api_key", "free", ("list_audiences", "add_subscriber", "send_campaign"), "Email marketing lists."),
    ("hubspot", "HubSpot", "social", "oauth2", "paid", ("list_contacts", "create_deal"), "CRM and marketing automation."),
    # ---------------- ai / data ----------------
    ("openai", "OpenAI", "ai", "api_key", "paid", ("chat_completion", "embed", "transcribe"), "Hosted LLM, embeddings and speech."),
    ("anthropic", "Anthropic", "ai", "api_key", "paid", ("chat_completion", "count_tokens"), "Claude model API."),
    ("ollama", "Ollama", "ai", "none", "free", ("chat_completion", "list_models", "embed"), "Local model runtime - no key required."),
    ("huggingface", "Hugging Face", "ai", "api_key", "free", ("inference", "search_models"), "Model hub and inference endpoints."),
    ("replicate", "Replicate", "ai", "api_key", "paid", ("run_model", "get_prediction"), "Hosted model runs."),
    ("pinecone", "Pinecone", "ai", "api_key", "paid", ("upsert", "query"), "Managed vector index."),
    ("qdrant", "Qdrant", "ai", "api_key", "free", ("upsert", "search"), "Self-hostable vector search."),
    ("elevenlabs", "ElevenLabs", "ai", "api_key", "paid", ("text_to_speech", "clone_voice"), "Voice synthesis and cloning."),
    # ---------------- infra / cloud ----------------
    ("aws-s3", "Amazon S3", "infra", "api_key", "paid", ("put_object", "get_object", "list_objects"), "Object storage."),
    ("cloudflare", "Cloudflare", "infra", "api_key", "free", ("purge_cache", "list_zones", "create_dns_record"), "DNS, CDN and Workers."),
    ("vercel", "Vercel", "infra", "api_key", "free", ("list_deployments", "create_deployment"), "Edge hosting and deployments."),
    ("netlify", "Netlify", "infra", "api_key", "free", ("list_sites", "create_deploy"), "Static hosting and functions."),
    ("flyio", "Fly.io", "infra", "api_key", "paid", ("list_apps", "create_machine"), "Global app hosting."),
    ("render", "Render", "infra", "api_key", "free", ("list_services", "create_deploy"), "Managed app hosting."),
    ("docker-hub", "Docker Hub", "infra", "api_key", "free", ("list_tags", "inspect_image"), "Container registry."),
    ("supabase", "Supabase", "infra", "api_key", "free", ("query", "insert", "storage_upload"), "Postgres, auth and storage."),
    ("postgres", "PostgreSQL", "infra", "api_key", "free", ("query", "execute"), "Direct SQL against a local or hosted cluster."),
    ("mongodb-atlas", "MongoDB Atlas", "infra", "api_key", "free", ("find", "insert_one"), "Document database."),
    ("redis", "Redis", "infra", "none", "free", ("get", "set", "publish"), "In-memory cache and pub/sub."),
    ("sentry", "Sentry", "infra", "api_key", "free", ("list_issues", "create_event"), "Error and performance monitoring."),
    ("datadog", "Datadog", "infra", "api_key", "paid", ("submit_metric", "list_monitors"), "Observability and alerting."),
    ("grafana", "Grafana", "infra", "api_key", "free", ("query_datasource", "list_dashboards"), "Dashboards over any datasource."),
    ("pagerduty", "PagerDuty", "infra", "api_key", "paid", ("trigger_incident", "resolve_incident"), "On-call paging."),
    # ---------------- research / web ----------------
    ("web-search", "Web Search", "research", "api_key", "free", ("search", "fetch_page"), "Search the open web and fetch pages."),
    ("arxiv", "arXiv", "research", "none", "free", ("search", "get_paper"), "Preprint metadata and PDFs."),
    ("newsapi", "NewsAPI", "research", "api_key", "free", ("top_headlines", "search"), "News headlines by topic."),
    ("serpapi", "SerpAPI", "research", "api_key", "paid", ("search", "maps_search"), "Structured SERP results."),
    ("wolfram-alpha", "Wolfram Alpha", "research", "api_key", "free", ("query",), "Computational knowledge answers."),
    # ---------------- media ----------------
    ("spotify", "Spotify", "media", "oauth2", "free", ("search", "create_playlist"), "Music catalog and playback control."),
    ("vimeo", "Vimeo", "media", "oauth2", "paid", ("upload", "list_videos"), "Video hosting."),
    ("cloudinary", "Cloudinary", "media", "api_key", "free", ("upload", "transform"), "Image and video transformations."),
    ("imgix", "imgix", "media", "api_key", "paid", ("transform",), "Real-time image CDN."),
)


def _build() -> tuple[ConnectorManifest, ...]:
    out: list[ConnectorManifest] = []
    seen: set[str] = set()
    for cid, name, category, auth_kind, tier, actions, description in _ROWS:
        if cid in seen:  # pragma: no cover - guards against copy/paste slips
            raise RuntimeError(f"duplicate connector id in catalog: {cid}")
        seen.add(cid)
        out.append(
            ConnectorManifest(
                id=cid,
                name=name,
                category=category,
                auth_kind=auth_kind,
                tier=tier,
                actions=actions,
                description=description,
            )
        )
    return tuple(out)


BUILTIN_CONNECTORS: tuple[ConnectorManifest, ...] = _build()


def load_catalog() -> Iterator[ConnectorManifest]:
    """Yield every built-in connector manifest."""
    yield from BUILTIN_CONNECTORS


def catalog_size() -> int:
    return len(BUILTIN_CONNECTORS)


def catalog_by_id() -> dict[str, ConnectorManifest]:
    return {m.id: m for m in BUILTIN_CONNECTORS}


def catalog_categories() -> dict[str, int]:
    counts: dict[str, int] = {}
    for m in BUILTIN_CONNECTORS:
        counts[m.category] = counts.get(m.category, 0) + 1
    return dict(sorted(counts.items()))
