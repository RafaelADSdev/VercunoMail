#!/bin/sh
set -eu
install -d -m 0750 -o opendkim -g opendkim /run/opendkim
install -m 0400 -o opendkim -g opendkim /run/secrets/vercuno-dkim /run/opendkim/vercuno.private
opendkim -x /etc/opendkim.conf
exec postfix start-fg
