export interface GraphLogCommit {
  oid: string;
  commit: {
    message: string;
    author: { name: string; timestamp: number };
    parent: string[];
  };
}

export interface GraphCommit {
  oid: string;
  message: string;
  author: string;
  timestamp: number;
  parents: string[];
  refs: string[];
  lane: number;
  parentLanes: number[];
  merge: boolean;
}

export interface GitGraphData {
  commits: GraphCommit[];
  lanes: string[];
}

export function buildGitGraph(histories: { name: string; entries: GraphLogCommit[] }[], depth = 80): GitGraphData {
  const byOid = new Map<string, { entry: GraphLogCommit; refs: string[] }>();
  histories.forEach((history) => {
    history.entries.forEach((entry, position) => {
      const existing = byOid.get(entry.oid);
      if (existing) {
        if (position === 0) existing.refs.push(history.name);
      } else {
        byOid.set(entry.oid, { entry, refs: position === 0 ? [history.name] : [] });
      }
    });
  });

  // Tri topologique : un parent n'est affiché qu'après tous ses enfants connus.
  const childCount = new Map<string, number>();
  byOid.forEach(({ entry }) => childCount.set(entry.oid, 0));
  byOid.forEach(({ entry }) => entry.commit.parent.forEach((parent) => {
    if (childCount.has(parent)) childCount.set(parent, (childCount.get(parent) ?? 0) + 1);
  }));
  const ready = [...byOid.keys()].filter((oid) => childCount.get(oid) === 0);
  const compareRecent = (a: string, b: string) => {
    const aa = byOid.get(a)!.entry;
    const bb = byOid.get(b)!.entry;
    return bb.commit.author.timestamp - aa.commit.author.timestamp || b.localeCompare(a);
  };
  const ordered: string[] = [];
  while (ready.length) {
    ready.sort(compareRecent);
    const oid = ready.shift()!;
    ordered.push(oid);
    byOid.get(oid)!.entry.commit.parent.forEach((parent) => {
      if (!childCount.has(parent)) return;
      const count = (childCount.get(parent) ?? 0) - 1;
      childCount.set(parent, count);
      if (count === 0) ready.push(parent);
    });
  }
  byOid.forEach((_item, oid) => { if (!ordered.includes(oid)) ordered.push(oid); });

  const lanes = new Map<string, number>();
  const freeLanes = new Set<number>();
  let nextLane = 0;
  const allocateLane = () => {
    if (freeLanes.size) {
      const lane = Math.min(...freeLanes);
      freeLanes.delete(lane);
      return lane;
    }
    return nextLane++;
  };
  const commits: GraphCommit[] = [];
  for (const oid of ordered) {
    const item = byOid.get(oid)!;
    const { entry } = item;
    let lane = lanes.get(entry.oid);
    if (lane === undefined) lane = allocateLane();
    lanes.delete(entry.oid);
    const parentLanes: number[] = [];
    entry.commit.parent.forEach((parent, index) => {
      let parentLane = lanes.get(parent);
      if (parentLane === undefined) {
        parentLane = index === 0 ? lane : allocateLane();
        lanes.set(parent, parentLane);
      }
      parentLanes.push(parentLane);
    });
    // Une voie est libérée quand ce commit rejoint une voie parente déjà tracée.
    if (!parentLanes.includes(lane)) freeLanes.add(lane);
    commits.push({
      oid: entry.oid,
      message: entry.commit.message.split("\n")[0],
      author: entry.commit.author.name,
      timestamp: entry.commit.author.timestamp,
      parents: [...entry.commit.parent],
      refs: item.refs,
      lane,
      parentLanes,
      merge: entry.commit.parent.length > 1,
    });
  }
  return { commits: commits.slice(0, depth), lanes: histories.map((history) => history.name) };
}
