import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

const virtualInterface = /vpn|tunnel|wintun|tailscale|zerotier|wireguard|docker|virtual|veth|vmnet|vmware|vbox|hyper-v|wsl|(^|[^a-z0-9])(utun|tun|tap|wg|ppp|ipsec)\d*($|[^a-z0-9])/i;
const privateAddress = (address: string) => /^10\.|^192\.168\./.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address);
const tailnetAddress = (address: string) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address);

/** Advertise ordinary network interfaces; tunnel and benchmark addresses are not LAN invitations. */
export function lanAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string[] {
  const addresses = Object.entries(interfaces).flatMap(([name, entries]) => virtualInterface.test(name) ? [] : (entries ?? []).filter(entry =>
    entry.family === 'IPv4' && !entry.internal && !/^(0\.|127\.|169\.254\.|198\.1[89]\.)/.test(entry.address) && !tailnetAddress(entry.address),
  ).map(entry => entry.address));
  return [...new Set(addresses)].sort((left, right) => Number(privateAddress(right)) - Number(privateAddress(left)));
}
