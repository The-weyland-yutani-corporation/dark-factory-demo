# Implemented architecture

## Runtime

The Node.js API serves the built React control room and exposes health,
readiness, version, policy, and factory operations contracts. The React surface
uses only those contracts; it does not infer state from GitHub or Azure.

`FactoryOperationsAdapter` is the production boundary. The default
`DemoFactoryOperationsAdapter` provides deterministic local records and derives
throughput, lead time, autonomous completion, retries, repairs, rollback rate,
escaped defects, MTTR, and estimated agent/runtime costs. Production mode fails
closed until an adapter is supplied instead of silently showing demo data.

## Decision lineage

Policy responses, goals, incidents, deployments, and audit events carry the
same required correlation envelope:

- goal ID and pull request
- commit SHA and workflow run ID
- deployment ID and runtime revision
- trace ID and correlation ID
- final policy verdict

The policy endpoint rejects incomplete envelopes and replaces the caller's
pending verdict with the evaluated result. This makes a decision traceable from
goal intake through merge, deployment, rollback, and incident handling.

## Control and delivery planes

GitHub Actions is the control plane. Agentic workflows intake and plan goals;
conventional workflows verify, integrate, deliver immutable images, progressively
shift traffic, and roll back. Azure Container Apps is the runtime plane.
Repository reconciliation and Azure deployment are intentionally separate,
explicit live activation steps. Local verification never changes either plane.

## Azure alert bridge

Azure Monitor sends common-alert-schema events to a function-authenticated
Azure Functions Flex Consumption endpoint. The alert adapter normalizes
severity, rule and correlation identifiers, commit SHA, and Container Apps
revision; claims a managed-identity-authenticated Table Storage key to suppress
retries; and sends the existing incident workflow a repository dispatch.

The adapter retrieves the Dark Factory Mage private key from private Key Vault
through its dedicated managed identity. It mints an installation token only for
App `5122991` installation `168176539` and never persists that token or a PAT.
The application and worker Container Apps remain independently deployed and
unchanged by this bridge.

## Failure behavior

Configuration is validated before the API listens. Missing production data
integration returns `503`. Policies deny by default. Delivery uses bounded
canaries and immutable digests. Incident fingerprints and correlation IDs make
retries idempotent. Teardown tooling emits a plan only and refuses `--apply`.
