// Tiny waypoint graph: friends and the cat walk node -> node through doorways.
import { NAV, NAV_EDGES } from '../world/layout.js';

const adj = {};
for (const [a, b] of NAV_EDGES) {
  (adj[a] ??= []).push(b);
  (adj[b] ??= []).push(a);
}

const dist = (a, b) => Math.hypot(NAV[a][0] - NAV[b][0], NAV[a][1] - NAV[b][1]);

// Dijkstra; `blocked(node)` can forbid nodes (e.g. behind a closed door for the cat)
export function nodePath(from, to, blocked = () => false) {
  if (from === to) return [from];
  const d = { [from]: 0 }, prev = {}, open = new Set([from]);
  while (open.size) {
    let cur = null;
    for (const n of open) if (cur === null || d[n] < d[cur]) cur = n;
    open.delete(cur);
    if (cur === to) break;
    for (const n of adj[cur] ?? []) {
      if (blocked(n) && n !== to) continue;
      const nd = d[cur] + dist(cur, n);
      if (d[n] === undefined || nd < d[n]) {
        d[n] = nd;
        prev[n] = cur;
        open.add(n);
      }
    }
  }
  if (d[to] === undefined) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev[path[0]]);
  return path;
}

// Full list of [x, z] points: current position -> its node -> ... -> target node -> target point
export function route(fromNode, pos, toNode, target, blocked) {
  const nodes = nodePath(fromNode, toNode, blocked);
  if (!nodes) return null;
  const pts = nodes.map((n) => NAV[n]);
  // skip the first node if we are basically standing on it
  if (Math.hypot(pts[0][0] - pos[0], pts[0][1] - pos[1]) < 0.2) pts.shift();
  pts.push(target);
  return { points: pts, nodes };
}
