FROM alpine:3.22

RUN apk add --no-cache sqlite

COPY scripts/backup-reading-recommender-sqlite.sh /usr/local/bin/backup-reading-recommender-sqlite

RUN chmod +x /usr/local/bin/backup-reading-recommender-sqlite

ENTRYPOINT ["/usr/local/bin/backup-reading-recommender-sqlite"]
