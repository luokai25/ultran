"""Connector subsystem: manifests, registry, catalog and the credential vault."""

from .catalog import BUILTIN_CONNECTORS, catalog_size, load_catalog
from .credentials import CredentialVault
from .registry import ConnectorManifest, ConnectorRegistry

__all__ = [
    "BUILTIN_CONNECTORS",
    "ConnectorManifest",
    "ConnectorRegistry",
    "CredentialVault",
    "catalog_size",
    "load_catalog",
]
