import type { Actor, Presence } from '../../contracts/studio';

export const PARTICIPANT_COLORS = ['#785ee8', '#dc3c3d', '#019c7f', '#fbb315', '#ce447d', '#10a122', '#257de0', '#d25f25'] as const;
export function participantColor(actor: Actor, chosen?: string): string {
  if (chosen && PARTICIPANT_COLORS.includes(chosen.toLowerCase() as typeof PARTICIPANT_COLORS[number])) return chosen.toLowerCase();
  let hash = 0; for (const character of actor.id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return PARTICIPANT_COLORS[hash % (actor.kind === 'agent' ? 8 : 7)]!;
}
export interface PresenceMember { actor: Actor; peer: Presence; peers: Presence[]; activeAt: number; color: string }
/** Keep all page peers for cursors, but choose one recent viewport for each person's follow action. */
export function presenceMembers(peers: Presence[], selfActorId: string): PresenceMember[] {
  const grouped = new Map<string, Presence[]>();
  for (const peer of peers) {
    if (peer.actor.id === selfActorId) continue;
    const pages = grouped.get(peer.actor.id) || [];
    pages.push(peer); grouped.set(peer.actor.id, pages);
  }
  return [...grouped.values()].map(pages => {
    pages.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const peer = pages.find(page => page.context?.viewport) || pages[0]!;
    return { actor: peer.actor, peer, peers: pages, activeAt: Date.parse(peer.updatedAt), color: participantColor(peer.actor, peer.color) };
  });
}

/** Lease heartbeats and sequence counters are not user activity. */
export class ParticipantActivity {
  private pages = new Map<string, { signature: string; at: number }>();
  read(peers: Presence[], selfActorId: string, now = Date.now()): PresenceMember[] {
    const present = new Set(peers.map(peer => peer.peerId));
    for (const key of this.pages.keys()) if (!present.has(key)) this.pages.delete(key);
    for (const peer of peers) {
      const signature = JSON.stringify([peer.context, peer.cursor, peer.chat, peer.following, peer.visible, peer.color]);
      const previous = this.pages.get(peer.peerId);
      if (!previous || previous.signature !== signature) this.pages.set(peer.peerId, { signature, at: previous ? now : Math.min(now, Date.parse(peer.updatedAt) || now) });
    }
    return presenceMembers(peers, selfActorId).map(member => {
      const pages = [...member.peers].sort((a, b) => (this.pages.get(b.peerId)?.at || 0) - (this.pages.get(a.peerId)?.at || 0));
      const peer = pages[0]!;
      return { ...member, peer, peers: pages, activeAt: this.pages.get(peer.peerId)?.at || now, color: participantColor(peer.actor, peer.color) };
    }).sort((a, b) => Number(b.actor.kind === 'agent') - Number(a.actor.kind === 'agent') || b.activeAt - a.activeAt);
  }
}

/** Same-person tabs share a claim; later conflicting claims choose the next free human color. */
export function claimParticipantColor(actor: Actor, selfPeerId: string, peers: Presence[], preferred?: string): string {
  const own = peers.find(peer => peer.actor.id === actor.id && peer.peerId !== selfPeerId && peer.color);
  const chosen = participantColor(actor, own?.color || preferred);
  const earlier = peers.filter(peer => peer.actor.id !== actor.id && peer.actor.id.localeCompare(actor.id) < 0);
  if (!earlier.some(peer => participantColor(peer.actor, peer.color) === chosen)) return chosen;
  const palette = PARTICIPANT_COLORS.slice(0, actor.kind === 'agent' ? 8 : 7);
  const others = peers.filter(peer => peer.actor.id !== actor.id);
  return [...palette].sort((a, b) => others.filter(peer => participantColor(peer.actor, peer.color) === a).length - others.filter(peer => participantColor(peer.actor, peer.color) === b).length)[0]!;
}
