import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, type NetworkInterfaceInfo } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { lanAddresses } from '../src/server/lan-addresses.js';
import { startStudioHost, type StudioHost } from '../src/server/http.js';

const { network } = vi.hoisted(() => ({ network: vi.fn() }));
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), networkInterfaces: network }));
const address = (value: string): NetworkInterfaceInfo => ({ family: 'IPv4', address: value, internal: false, netmask: '255.255.255.0', cidr: `${value}/24`, mac: '00:11:22:33:44:55' });
const observed = { Meta: [address('198.18.0.1')], 'vEthernet (Default Switch)': [address('172.19.128.1')], WLAN: [address('192.168.3.241')] };
let folder: string | undefined, host: StudioHost | undefined;
beforeEach(() => network.mockReturnValue(observed));
afterEach(async () => {
  await host?.close(); host = undefined;
  if (folder) { expect(resolve(folder).startsWith(resolve(tmpdir()) + sep)).toBe(true); await rm(folder, { recursive: true, force: true }); folder = undefined; }
  vi.restoreAllMocks();
});

describe('LAN address selection', () => {
  it('chooses the observed physical WLAN instead of Meta benchmark or Hyper-V addresses', () => {
    expect(lanAddresses(observed)).toEqual(['192.168.3.241']);
  });
  it.each([
    { utun0: [address('10.99.0.1')], en0: [address('192.168.1.30')] },
    { 'Tailscale Tunnel': [address('100.100.10.1')], Ethernet: [address('10.1.0.30')] },
    { docker0: [address('172.17.0.1')], veth123: [address('172.18.0.1')], eth0: [address('172.20.1.30')] },
  ])('prefers ordinary interfaces over platform tunnel/virtual interfaces: %o', interfaces => {
    expect(lanAddresses(interfaces)).toHaveLength(1);
    expect(lanAddresses(interfaces)[0]).toMatch(/^(192\.168\.1\.30|10\.1\.0\.30|172\.20\.1\.30)$/);
  });
  it('prioritizes private LAN addresses, deduplicates and keeps distinct ordinary networks', () => {
    expect(lanAddresses({ Ethernet: [address('203.0.113.20')], WiFi: [address('10.0.0.50'), address('10.0.0.50')], en1: [address('192.168.20.50')] })).toEqual(['10.0.0.50', '192.168.20.50', '203.0.113.20']);
  });
  it('does not invent a LAN invitation from only virtual, link-local or benchmark addresses', () => {
    expect(lanAddresses({ Meta: [address('198.19.1.1')], loopback: [{ ...address('127.0.0.1'), internal: true }], local: [address('169.254.1.1')], tunnel: [address('10.0.0.1')], unnamed: [address('100.64.0.2')] })).toEqual([]);
  });
  it('uses the physical candidate in real HTTP host share links', async () => {
    folder = await mkdtemp(join(tmpdir(), 'studio-lan-addresses-')); host = await startStudioHost({ dataRoot: folder });
    const { artifact } = await host.service.execute('artifact_manage', { action: 'create' });
    const share = await host.service.execute('artifact_share', { artifactId: artifact.id, action: 'start' });
    expect(share.enabled).toBe(true);
    expect(new URL(share.links.editor).hostname).toBe('192.168.3.241');
    expect(new URL(share.links.viewer).hostname).toBe('192.168.3.241');
  });
  it('fails explicitly without enabling sharing when no ordinary interface exists', async () => {
    network.mockReturnValue({ Meta: [address('198.18.0.1')], utun0: [address('10.0.0.1')] });
    folder = await mkdtemp(join(tmpdir(), 'studio-lan-addresses-')); host = await startStudioHost({ dataRoot: folder });
    const { artifact } = await host.service.execute('artifact_manage', { action: 'create' });
    await expect(host.service.execute('artifact_share', { artifactId: artifact.id, action: 'start' })).rejects.toMatchObject({ code: 'NO_NETWORK' });
    expect(await host.service.execute('artifact_share', { artifactId: artifact.id, action: 'status' })).toMatchObject({ enabled: false, links: {} });
  });
});
