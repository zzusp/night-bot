# syntax=docker/dockerfile:1
ARG DEBIAN_ARCHIVE_URL=https://deb.debian.org/debian
ARG DEBIAN_SECURITY_URL=https://deb.debian.org/debian-security
FROM node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f AS build
ARG DEBIAN_ARCHIVE_URL
ARG DEBIAN_SECURITY_URL

# 固定 slim 镜像无系统 CA；先用同版 Node 的内置公共根引导受验证的 HTTPS。
RUN node --input-type=module -e "import {rootCertificates} from 'node:tls'; import {writeFileSync} from 'node:fs'; writeFileSync('/tmp/night-debian-roots.pem',rootCertificates.join('\n')+'\n',{mode:0o644})" \
    && node --input-type=module -e "import {readFileSync,writeFileSync} from 'node:fs'; const p='/etc/apt/sources.list.d/debian.sources'; let s=readFileSync(p,'utf8'); for(const [key,path] of [['DEBIAN_ARCHIVE_URL','debian'],['DEBIAN_SECURITY_URL','debian-security']]){const u=new URL(process.env[key]); if(u.protocol!=='https:'||u.username||u.password||/[?#]/.test(process.env[key]))throw Error('Invalid Debian HTTPS mirror'); const from='URIs: http://deb.debian.org/'+path; if(!s.split('\n').includes(from))throw Error('Unexpected Debian source'); s=s.replace(from+'\n','URIs: '+u.href.replace(/\/$/,'')+'\n');} writeFileSync(p,s);" \
    && apt-get -o Acquire::https::CAInfo=/tmp/night-debian-roots.pem -o Acquire::https::Verify-Peer=true update \
    && apt-get -o Acquire::https::CAInfo=/tmp/night-debian-roots.pem -o Acquire::https::Verify-Peer=true install -y --no-install-recommends ca-certificates curl g++ make python3 \
    && rm -f /tmp/night-debian-roots.pem \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@11.25.0
WORKDIR /opt/night-bot
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN node --input-type=module -e "import p from './package.json' with {type:'json'}; if(p.packageManager !== 'pnpm@11.25.0') process.exit(1)" \
    && pnpm install --frozen-lockfile --prod

# 官方 v1.0.67 发行资产，摘要来自 release API。
ARG TARGETARCH
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) checksum=25959351407e51d4aba7638790ff1cd04fdd7eaa56b313a26b689c03628e0ee2 ;; \
      arm64) checksum=1170453962f1bd049f27097385cab8b68dbf25cd69f45eb020e5d3bca0cad605 ;; \
      *) echo 'DWS supports only linux/amd64 and linux/arm64 in this image' >&2; exit 1 ;; \
    esac; \
    mkdir -p /tmp/night-dws-download /tmp/night-dws-extract; \
    curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 \
      "https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/releases/download/v1.0.67/dws-linux-${TARGETARCH}.tar.gz" \
      --output /tmp/night-dws-download/dws.tar.gz; \
    printf '%s  %s\n' "$checksum" /tmp/night-dws-download/dws.tar.gz | sha256sum --check --strict; \
    tar --extract --gzip --file /tmp/night-dws-download/dws.tar.gz --directory /tmp/night-dws-extract --no-same-owner; \
    binary="$(find /tmp/night-dws-extract -type f -name dws)"; \
    test -n "$binary" && test "$(printf '%s\n' "$binary" | wc -l)" -eq 1; \
    install -m 0755 "$binary" /usr/local/bin/dws; \
    mkdir -p /usr/local/share/licenses/dws; \
    for name in LICENSE NOTICE; do \
      curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 \
        "https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/v1.0.67/${name}" \
        --output "/tmp/night-dws-download/${name}"; \
    done; \
    printf '%s  %s\n' \
      1d951e8ca1019e1ad6fc14b8450df1b7ba788b9f242002873ca79df70ee376fd /tmp/night-dws-download/LICENSE \
      b7d8a7d7c3c61cb0d4d78fa422fb81028c76d0e7ff1a23b1be68f058a9920d80 /tmp/night-dws-download/NOTICE \
      | sha256sum --check --strict; \
    install -m 0644 /tmp/night-dws-download/LICENSE /tmp/night-dws-download/NOTICE /usr/local/share/licenses/dws/; \
    rm -rf /tmp/night-dws-download /tmp/night-dws-extract

COPY packages/web-console/package.json packages/web-console/pnpm-lock.yaml packages/web-console/pnpm-workspace.yaml ./packages/web-console/
RUN pnpm --dir packages/web-console install --frozen-lockfile
COPY packages/web-console/index.html packages/web-console/tsconfig.json packages/web-console/vite.config.ts ./packages/web-console/
COPY packages/web-console/src ./packages/web-console/src
RUN pnpm --dir packages/web-console build

FROM node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f AS runtime
ARG DEBIAN_ARCHIVE_URL
ARG DEBIAN_SECURITY_URL
# 固定 slim 镜像无系统 CA；先用同版 Node 的内置公共根引导受验证的 HTTPS。
RUN node --input-type=module -e "import {rootCertificates} from 'node:tls'; import {writeFileSync} from 'node:fs'; writeFileSync('/tmp/night-debian-roots.pem',rootCertificates.join('\n')+'\n',{mode:0o644})" \
    && node --input-type=module -e "import {readFileSync,writeFileSync} from 'node:fs'; const p='/etc/apt/sources.list.d/debian.sources'; let s=readFileSync(p,'utf8'); for(const [key,path] of [['DEBIAN_ARCHIVE_URL','debian'],['DEBIAN_SECURITY_URL','debian-security']]){const u=new URL(process.env[key]); if(u.protocol!=='https:'||u.username||u.password||/[?#]/.test(process.env[key]))throw Error('Invalid Debian HTTPS mirror'); const from='URIs: http://deb.debian.org/'+path; if(!s.split('\n').includes(from))throw Error('Unexpected Debian source'); s=s.replace(from+'\n','URIs: '+u.href.replace(/\/$/,'')+'\n');} writeFileSync(p,s);" \
    && apt-get -o Acquire::https::CAInfo=/tmp/night-debian-roots.pem -o Acquire::https::Verify-Peer=true update \
    && apt-get -o Acquire::https::CAInfo=/tmp/night-debian-roots.pem -o Acquire::https::Verify-Peer=true install -y --no-install-recommends bash bubblewrap ca-certificates findutils git grep procps tini util-linux \
    && rm -f /tmp/night-debian-roots.pem \
    && rm -rf /var/lib/apt/lists/* \
    && chmod u-s /usr/bin/bwrap
COPY --from=build /usr/local/bin/dws /usr/local/bin/dws
COPY --from=build /usr/local/share/licenses/dws /usr/local/share/licenses/dws
COPY --from=build /usr/local/lib/node_modules/pnpm /usr/local/lib/node_modules/pnpm
RUN ln -s ../lib/node_modules/pnpm/bin/pnpm.mjs /usr/local/bin/pnpm \
    && ln -s ../lib/node_modules/pnpm/bin/pnpx.mjs /usr/local/bin/pnpx
WORKDIR /opt/night-bot
COPY --from=build /opt/night-bot/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml config.example.json LICENSE THIRD_PARTY.md ./
COPY licenses ./licenses
COPY bin ./bin
COPY src ./src
COPY packages/dingtalk-core ./packages/dingtalk-core
COPY packages/web-console/night-channel.json packages/web-console/package.json ./packages/web-console/
COPY packages/web-console/server ./packages/web-console/server
COPY packages/web-console/licenses ./packages/web-console/licenses
COPY --from=build /opt/night-bot/packages/web-console/dist ./packages/web-console/dist
COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN mkdir -p data/temp && chown node:node data data/temp && chmod 0700 data data/temp
ENV NODE_ENV=production \
    HOME=/opt/night-bot/data/secrets/dws-system \
    DWS_CONFIG_DIR=/opt/night-bot/data/secrets/dws-system/config \
    DWS_KEYCHAIN_DIR=/opt/night-bot/data/secrets/dws-system/keychain \
    XDG_CACHE_HOME=/opt/night-bot/data/cache \
    TMPDIR=/opt/night-bot/data/temp \
    TMP=/opt/night-bot/data/temp \
    TEMP=/opt/night-bot/data/temp
USER node
ENTRYPOINT ["/usr/bin/tini", "--", "/bin/sh", "/opt/night-bot/scripts/docker-entrypoint.sh"]
CMD ["run"]
