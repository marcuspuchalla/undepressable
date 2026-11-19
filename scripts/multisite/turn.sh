#!/bin/sh
# Test TURN relay for the multi-site scenarios, on a host reachable over SSH.
#
#   scripts/multisite/turn.sh up   HOST PUBLIC_IP SECRET_FILE
#   scripts/multisite/turn.sh down HOST
#
# coturn in a host-network container: UDP/TCP 3479, TLS 5349 (self-signed —
# Chrome rejects it, see MULTISITE_RESULTS.md), relay ports 49160–50159.
# Refuses to relay to private, loopback, link-local and NetBird/CGNAT
# (100.64.0.0/10) addresses, so it can't be used to reach the VPN mesh.
# Firewall rules are added with ufw and labelled undep-test-turn.
set -eu
cmd="$1"; host="$2"
PORTS="3479/udp 3479/tcp 5349/tcp 49160:50159/udp"

case "$cmd" in
  up)
    ip="$3"; secret=$(cat "$4")
    tmp=$(mktemp -d)
    openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=$ip" \
      -keyout "$tmp/key.pem" -out "$tmp/cert.pem" 2>/dev/null
    ssh -o BatchMode=yes "$host" 'sudo -n mkdir -p /opt/undep-test-turn && sudo -n chmod 755 /opt/undep-test-turn'
    for f in cert.pem key.pem; do
      ssh -o BatchMode=yes "$host" "sudo -n tee /opt/undep-test-turn/$f >/dev/null && sudo -n chmod 644 /opt/undep-test-turn/$f" < "$tmp/$f"
    done
    rm -rf "$tmp"
    ssh -o BatchMode=yes "$host" "sudo -n docker rm -f undep-test-turn >/dev/null 2>&1 || true
      sudo -n docker run -d --name undep-test-turn --restart no --network host -v /opt/undep-test-turn:/certs:ro coturn/coturn:latest \
        -n --log-file=stdout --verbose --listening-ip=$ip --external-ip=$ip \
        --listening-port=3479 --tls-listening-port=5349 --min-port=49160 --max-port=50159 \
        --lt-cred-mech --user=undeptest:$secret --realm=undep.test --fingerprint \
        --cert=/certs/cert.pem --pkey=/certs/key.pem --user-quota=1000 --total-quota=2000 --no-multicast-peers \
        --denied-peer-ip=10.0.0.0-10.255.255.255 --denied-peer-ip=172.16.0.0-172.31.255.255 \
        --denied-peer-ip=192.168.0.0-192.168.255.255 --denied-peer-ip=100.64.0.0-100.127.255.255 \
        --denied-peer-ip=127.0.0.0-127.255.255.255 --denied-peer-ip=169.254.0.0-169.254.255.255 >/dev/null
      for p in $PORTS; do sudo -n ufw allow \$p comment undep-test-turn >/dev/null; done
      echo relay up on $ip" ;;
  down)
    ssh -o BatchMode=yes "$host" "sudo -n docker rm -f undep-test-turn >/dev/null 2>&1 || true
      for p in $PORTS 49160:49359/udp; do sudo -n ufw delete allow \$p >/dev/null 2>&1 || true; done
      sudo -n rm -rf /opt/undep-test-turn
      echo relay down; sudo -n ufw status | grep -c undep-test-turn || true" ;;
  *) echo "usage: $0 up HOST PUBLIC_IP SECRET_FILE | down HOST" >&2; exit 2 ;;
esac
