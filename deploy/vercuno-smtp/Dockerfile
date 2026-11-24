FROM debian:bookworm-slim
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends postfix opendkim ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY main.cf /etc/postfix/main.cf
COPY opendkim.conf /etc/opendkim.conf
COPY dkim-trusted-hosts /etc/opendkim/trusted-hosts
COPY entrypoint.sh /usr/local/sbin/vercuno-smtp
RUN chmod 755 /usr/local/sbin/vercuno-smtp \
    && postconf -F 'smtp/inet/chroot=n' 'smtp/unix/chroot=n' 'relay/unix/chroot=n'
VOLUME ["/var/spool/postfix"]
HEALTHCHECK --interval=20s --timeout=5s CMD postfix status || exit 1
CMD ["/usr/local/sbin/vercuno-smtp"]
