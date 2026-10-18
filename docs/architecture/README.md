# Dark Factory \u2014 End-to-End Architecture

This diagram shows the implemented "dark factory" lifecycle for this repository: a structured
GitHub issue drives an agentic workflow that writes, reviews, verifies, and merges code; the
change is built and deployed to Azure Container Apps; telemetry and deployment signals feed back
into GitHub as deduplicated incidents that re-enter the same loop; and a separate guardrail
isolates, replays, and verdicts any change the factory makes to its own workflow before it can
affect production.

## Files

The simplified [`customer-journey.svg`](customer-journey.svg) is an original,
self-contained customer-facing overview with an embedded accessible description.
It distinguishes local simulation from configured live delivery; edit this SVG
directly. The detailed diagram sources below remain unchanged.

| File                                                                                             | Purpose                                                                                                        |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| [`dark-factory-architecture.drawio`](./dark-factory-architecture.drawio)                         | Editable source (open in [diagrams.net](https://app.diagrams.net) / the draw.io desktop or VS Code extension). |
| [`dark-factory-architecture.svg`](./dark-factory-architecture.svg)                               | Rendered, standalone SVG for viewing in GitHub, docs sites, or a browser.                                      |
| [`dark-factory-nested-engineering-loops.drawio`](./dark-factory-nested-engineering-loops.drawio) | Editable source for the nested inner delivery, outer production-learning, and self-modification loops.         |
| [`dark-factory-nested-engineering-loops.svg`](./dark-factory-nested-engineering-loops.svg)       | Self-contained rendered view of the repository's nested engineering loops.                                     |

The original pair is generated from the same layout data so it stays in sync; if you edit one, prefer
re-deriving the other rather than hand-editing them independently (see _Regenerating_ below).

The nested-loop pair is a second, complementary view. It emphasizes control flow rather than the
deployed resource topology:

- The **inner loop** follows the policy lifecycle and repository workflow names from goal intake
  through planning, implementation, SHA-bound deterministic checks, independent review, bounded
  repair, and the autonomous integration gate.
- The **outer loop** starts from a verified merge to `main`, builds and attests one immutable ACR
  image, uses GitHub OIDC for the Azure trust exchange, progressively shifts Container Apps
  traffic, observes health/readiness/version/synthetic and Azure Monitor signals, and routes a
  stable incident fingerprint to rollback or one deduplicated fix-forward goal.
- The **self-modification guardrail** reflects `scripts/self-modification/evaluate.mjs` and
  `.github/autonomy/policy.json`: isolated candidate evaluation, canonical scenario replay,
  evidence and permission checks, an Ed25519-signed verdict plus integration-result attestation,
  a bounded synthetic canary, and failure routing to canary reversion and a terminal incident.

The editable and rendered nested-loop assets use the same node labels, positions, trust
boundaries, and line-style legend. The SVG contains only inline vector shapes, text, CSS, and
markers; it has no external image, font, script, or hyperlink dependency.

## Diagram conventions

Layout, labeling, and boundary choices follow the Azure Well-Architected Framework guidance on
[creating architecture design diagrams](https://learn.microsoft.com/en-us/azure/well-architected/architect-role/design-diagrams):

- **Trust boundaries are explicit containers.** GitHub (SaaS, outside Azure), the Azure
  subscription, the VNet-integrated Container Apps environment, and the observability scope are
  each drawn as labeled, distinctly-dashed boundary boxes rather than implied by proximity.
- **Arrows are single-directional and labeled** where the relationship isn't obvious from
  context (for example `pull image`, `federated token (no PAT)`, `dedup incident`).
- **Line style carries meaning, not just color**, per the accessibility guidance: solid lines are
  request/control/traffic flow, dashed lines are feedback/telemetry/repair signals, and the
  dashed red line is the incident-correlation path that creates a new goal. A legend in the
  diagram documents this.
- **Nodes are colored by service category** (GitHub vs. Azure compute/identity/security/data/
  operations/networking) consistently across the diagram; see the mapping below.
- **The diagram is scoped to one concern** (the closed-loop build \u2192 deploy \u2192 observe \u2192
  remediate \u2192 rebuild lifecycle, plus the self-modification guardrail) rather than overloading it
  with every subsystem.

## Icons

The official [Azure architecture icon set](https://learn.microsoft.com/en-us/azure/architecture/icons/)
is distributed by Microsoft as a downloadable asset package (not individually hosted files), and
its usage guidelines prohibit cropping, recoloring, or otherwise altering the icon artwork. To
avoid redistributing modified copies of Microsoft's trademarked icon files, this diagram instead
follows the _documented conventions_ of that icon set \u2014 solid-color rounded squares, one accent
color per service category, a simple white glyph, and the service name printed next to the icon
\u2014 using original, generic glyphs (a generic "box" for compute, a key for Key Vault, a cylinder for
data stores, a magnifying glass for monitoring/observability services, a person for identity, and
a network/hub glyph for networking). GitHub nodes use a generic issue/commit-graph glyph rather
than the GitHub logo, for the same reason.

If you need the exact, pixel-identical Microsoft icons (for example to paste into a different
corporate deck), download the official set from the link above and swap the glyphs in the
`.drawio` source \u2014 the shapes are plain rectangles so any stencil can be dropped in without
changing the layout.

| Category                | Color     | Used for                                                                                            |
| ----------------------- | --------- | --------------------------------------------------------------------------------------------------- |
| GitHub (primary)        | `#24292F` | Issues, Actions, branch protection/merge queue                                                      |
| GitHub (secondary)      | `#57606A` | OIDC federation                                                                                     |
| Compute                 | `#0078D4` | Container Registry, Container Apps, revisions/traffic/health                                        |
| Identity                | `#773ADC` | Managed Identities                                                                                  |
| Security                | `#D13438` | Key Vault, incident correlation path                                                                |
| Data                    | `#00B294` | PostgreSQL Flexible Server, DB migrations                                                           |
| Networking              | `#773ADC` | Private Endpoints, Private DNS Zones                                                                |
| Operations / monitoring | `#8661C5` | Log Analytics, Application Insights, Azure Monitor, self-modification guardrail, signal correlation |

## Lifecycle depicted

1. **Intake & change**: a structured GitHub **Goal Issue** feeds the agentic workflow's
   **Intake & Planning** step. The implementer writes code through an App-authenticated
   **create-pull-request** safe output; an **independent review** (separate agent/session)
   evaluates it, and bounded repair uses **push-to-pull-request-branch** only for the one
   reconciled pull request.
2. **Verification & merge**: GitHub Actions perform **deterministic verification** and emit
   **SHA-bound evidence**; the **integration policy** (merge queue / auto-merge) then lands the
   change on `main`.
3. **Deploy**: **GitHub OIDC** (federated credential, no stored secrets) authenticates to Azure;
   the built image is pushed as an **immutable, SHA-tagged** artifact to **Azure Container
   Registry**, then rolled out as a **new revision** of the Container Apps **Web/API** and
   **Worker** apps inside a **VNet-enabled, workload-profile** Container Apps environment, with
   **managed identities**, **PostgreSQL Flexible Server**, and **Key Vault** reachable only via
   **private endpoints** and **private DNS**.
4. **Progressive rollout**: **DB migrations** run, then **health / readiness / version /
   synthetic checks** gate a **progressive traffic shift**, with automatic **rollback** to the
   previous revision on failure.
5. **Observe & close the loop**: **Log Analytics**, **Application Insights**, and **Azure
   Monitor + alerts** collect telemetry; a correlation step **deduplicates** alerts, workflow
   signals, and deployment signals into a single **GitHub incident issue**, which **re-enters**
   intake \u2014 closing the loop.
6. **Self-modification guardrail**: when the factory changes its _own_ workflow, the change is
   first run through **isolated evaluation**, **canonical scenario replay**, and a **signed
   verdict**; only a passing verdict proceeds to a **synthetic canary**, with **automatic
   reversion** on any regression.

## Regenerating

The diagram was produced from a small Python data model (one list of nodes/containers/edges)
that emits both the `.drawio` XML and the `.svg` in one pass, which is why the two files match
pixel-for-pixel. The generator script is a disposable build tool and isn't part of this
repository; to make further edits, either edit the `.drawio` file directly in diagrams.net (the
usual workflow), or ask for the layout script to reproduce a similar generator from this
specification.

## Validation

- Both files reference no external assets \u2014 the SVG is self-contained (inline shapes/text, no
  `<image>` links), and the `.drawio` file embeds the same shapes directly, so there are no
  broken local asset references to check.
- Opening `dark-factory-architecture.drawio` in diagrams.net reproduces the same layout as the
  SVG.
