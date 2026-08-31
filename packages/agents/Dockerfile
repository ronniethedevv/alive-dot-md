# First-party agent service. Zero dependencies, so there is no install step and
# nothing to lock: Node 22 supplies fetch, node:sqlite and TypeScript stripping.
FROM node:22-alpine

WORKDIR /app

# The service imports the classifier and RPC pool from the indexer, and chain
# constants from packages/shared, so those come along.
COPY packages/agents/src   ./packages/agents/src
COPY packages/shared/src   ./packages/shared/src
COPY indexer/src           ./indexer/src

ENV PORT=8080
EXPOSE 8080

# AGENT_BASE_URL must be set to the public https origin at run time. The
# registration files are generated from it, and those URLs go on chain - a
# wrong value there is a permanent, publicly broken identity.
CMD ["node", "--experimental-strip-types", "--no-warnings", "packages/agents/src/service.ts"]
