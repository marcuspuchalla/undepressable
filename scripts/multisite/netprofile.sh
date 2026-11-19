#!/bin/sh
# Shape this container's network, then hand over to the agent.
#
# Rules apply to the container's OWN network namespace only. On a container
# started with --network host they would rewrite the host's firewall — on these
# machines that is a production mail/log/app server — so anything but "open"
# refuses to run unless we're on an isolated (bridge) network.
#
# PROFILE:
#   open         no changes (real NAT/firewall of wherever this runs)
#   no-direct    no UDP to PEER_IPS (the other sites): what two strict NATs do to ICE
#   udp-blocked  no UDP at all (+DNS): corporate/hotel firewalls, QUIC blocked
#   hostile      TCP only to 443 and TURN_IP:TURN_TLS_PORT, no UDP: DPI-ish networks
#   lossy        150±50 ms, 3 % loss, 2 Mbit/s  (congested event Wi-Fi)
#   bad-mobile   350±100 ms, 8 % loss, 600 kbit/s (one bar of 3G)
set -eu
PROFILE="${PROFILE:-open}"

if [ "$PROFILE" != open ]; then
  if ip link show docker0 >/dev/null 2>&1 || ip link show wt0 >/dev/null 2>&1; then
    echo '{"event":"error","message":"refusing to shape the network: this looks like the HOST namespace (--network host)"}'
    exit 2
  fi
  # Old kernels (Synology 3.10) have no nftables; fall back to legacy iptables.
  iptables -L >/dev/null 2>&1 || update-alternatives --set iptables /usr/sbin/iptables-legacy >/dev/null
fi

dns_and_lo() {
  iptables -A OUTPUT -o lo -j ACCEPT
  iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
  iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT
}

case "$PROFILE" in
  open) ;;
  no-direct)
    # Drop UDP to the other participants only. STUN still works, as it does
    # behind a real strict NAT — the viewer learns its public address, which a
    # relay needs before it may forward to it — but no direct path forms.
    if [ -n "${PEER_IPS:-}" ]; then
      for ip in $(echo "$PEER_IPS" | tr ',' ' '); do iptables -A OUTPUT -p udp -d "$ip" -j DROP; done
    else
      dns_and_lo
      [ -n "${TURN_IP:-}" ] && iptables -A OUTPUT -p udp -d "$TURN_IP" -j ACCEPT
      iptables -A OUTPUT -p udp -j DROP
    fi ;;
  udp-blocked)
    dns_and_lo
    iptables -A OUTPUT -p udp -j DROP ;;
  hostile)
    dns_and_lo
    iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT
    [ -n "${TURN_IP:-}" ] && iptables -A OUTPUT -p tcp -d "$TURN_IP" --dport "${TURN_TLS_PORT:-5349}" -j ACCEPT
    iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
    iptables -A OUTPUT -j DROP ;;
  lossy)
    tc qdisc add dev eth0 root netem delay 150ms 50ms loss 3% rate 2mbit ;;
  bad-mobile)
    tc qdisc add dev eth0 root netem delay 350ms 100ms loss 8% rate 600kbit ;;
  *)
    echo "{\"event\":\"error\",\"message\":\"unknown PROFILE $PROFILE\"}"; exit 2 ;;
esac

exec node /agent/agent.mjs "$@"
