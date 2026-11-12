import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, ScrollView, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { MONO, timeAgo } from "@/components/GitUi";
import type { GraphCommit } from "@/utils/git/engine";
import { C } from "@/constants/colors";

const ROW_HEIGHT = 72;
const LANE_WIDTH = 30;
const NODE_SIZE = 10;
const PALETTE = [C.cyan, C.violet, C.green, C.amber, C.blue, "#f778ba", "#79c0ff", "#d2a8ff"];

type Props = {
  commits: GraphCommit[];
  onCommitPress: (oid: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

function AnimatedConnector({ x1, y1, x2, y2, color, delay, reduceMotion }: {
  x1: number; y1: number; x2: number; y2: number; color: string; delay: number; reduceMotion: boolean;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 360,
      delay,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, progress, reduceMotion]);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: (x1 + x2) / 2 - length / 2,
        top: (y1 + y2) / 2 - 1.5,
        width: length,
        height: 3,
        borderRadius: 2,
        backgroundColor: color,
        opacity: progress,
        transform: [{ rotate: `${angle}rad` }, { scaleX: progress }],
      }}
    />
  );
}

function AnimatedNode({ left, top, color, merge, background, reduceMotion }: {
  left: number; top: number; color: string; merge: boolean; background: string; reduceMotion: boolean;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.spring(progress, {
      toValue: 1,
      speed: 16,
      bounciness: 5,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left,
        top,
        width: NODE_SIZE,
        height: NODE_SIZE,
        borderRadius: NODE_SIZE / 2,
        backgroundColor: merge ? C.violet : background,
        borderWidth: merge ? 3 : 2,
        borderColor: merge ? C.violet : color,
        shadowColor: color,
        shadowOpacity: 0.75,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 0 },
        elevation: 3,
        opacity: progress,
        transform: [{ scale: progress }],
      }}
    />
  );
}

export function GitCommitGraph({ commits, onCommitPress, t }: Props) {
  const colors = useColors();
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((enabled) => { if (active) setReduceMotion(!!enabled); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  const graph = useMemo(() => {
    const indexByOid = new Map(commits.map((commit, index) => [commit.oid, index]));
    const maxLane = commits.reduce((max, commit) => Math.max(max, commit.lane, ...commit.parentLanes), 0);
    const connectors: { key: string; x1: number; y1: number; x2: number; y2: number; color: string; delay: number }[] = [];
    commits.forEach((commit, index) => {
      commit.parents.forEach((parent, parentIndex) => {
        const parentRow = indexByOid.get(parent);
        if (parentRow === undefined) return;
        const targetLane = commit.parentLanes[parentIndex] ?? commit.lane;
        connectors.push({
          key: `${commit.oid}-${parent}`,
          x1: commit.lane * LANE_WIDTH + LANE_WIDTH / 2,
          y1: index * ROW_HEIGHT + ROW_HEIGHT / 2,
          x2: targetLane * LANE_WIDTH + LANE_WIDTH / 2,
          y2: parentRow * ROW_HEIGHT + ROW_HEIGHT / 2,
          color: PALETTE[targetLane % PALETTE.length],
          delay: Math.min(index * 12, 420),
        });
      });
    });
    return { connectors, width: (maxLane + 1) * LANE_WIDTH + 4 };
  }, [commits]);

  if (!commits.length) return null;
  const height = commits.length * ROW_HEIGHT;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View style={{ width: graph.width + 330, height, position: "relative" }}>
        {graph.connectors.map((line) => (
          <AnimatedConnector key={line.key} {...line} reduceMotion={reduceMotion} />
        ))}
        {commits.map((commit, index) => {
          const x = commit.lane * LANE_WIDTH + LANE_WIDTH / 2;
          const color = PALETTE[commit.lane % PALETTE.length];
          return (
            <Pressable
              key={commit.oid}
              onPress={() => onCommitPress(commit.oid)}
              accessibilityRole="button"
              accessibilityLabel={`Commit ${commit.oid.slice(0, 7)} : ${commit.message}`}
              style={({ pressed }) => ({
                position: "absolute",
                left: 0,
                top: index * ROW_HEIGHT,
                width: graph.width + 326,
                height: ROW_HEIGHT,
                flexDirection: "row",
                alignItems: "center",
                paddingRight: 10,
                backgroundColor: pressed ? colors.secondary : "transparent",
              })}
            >
              <View style={{ width: graph.width, height: ROW_HEIGHT, justifyContent: "center" }}>
                <AnimatedNode
                  left={x - NODE_SIZE / 2}
                  top={ROW_HEIGHT / 2 - NODE_SIZE / 2}
                  color={color}
                  merge={commit.merge}
                  background={colors.background}
                  reduceMotion={reduceMotion}
                />
              </View>
              <View style={{ flex: 1, minWidth: 0, paddingLeft: 10, justifyContent: "center" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, fontFamily: "Inter_600SemiBold", flexShrink: 1 }}>
                    {commit.message || t("g.graph.noMessage")}
                  </Text>
                  {commit.merge ? <Text style={{ color: C.violet, fontSize: 11, fontFamily: "Inter_700Bold" }}>{t("g.graph.mergeTag")}</Text> : null}
                </View>
                <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 4 }} numberOfLines={1}>
                  {commit.author} · {timeAgo(commit.timestamp * 1000, t)}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
                  <Text style={{ color: colors.accent, fontSize: 11, fontFamily: MONO }}>{commit.oid.slice(0, 7)}</Text>
                  {commit.refs.map((ref) => (
                    <View key={ref} style={{ borderWidth: 1, borderColor: color, backgroundColor: `${color}18`, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 }}>
                      <Text style={{ color, fontSize: 11, fontFamily: "Inter_600SemiBold" }} numberOfLines={1}>{ref}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}
