import type { GuidanceTopic } from "@hpai/shared/guidance/official";
import type { ReactNode } from "react";

/**
 * 「鶏を飼っていない方へ」の節と「分かっていること」の知見に添える線画（設計書 2026-11-06-public-known-redesign §9）。
 * Claude が作成した絵（作品のコードの中の SVG。外の素材を使わない）。紺の線と淡い面だけで、色は public.css の --ill-* から取る。
 * 飾りなので読み上げでは飛ばす（aria-hidden）。文字（<text>）を入れない（見出しの文字に混ざらないように）。
 * 絵は国の文や知見の中身を足さない。「すること」や話題の目印にとどめる。
 */
export type KnownIllust =
  | "recurrence"
  | "basic-management"
  | "water-and-flock-size"
  | "small-flock"
  | "changing-shoes"
  | "standard-measures"
  | "neighbor-cases";
export type IllustName = GuidanceTopic | KnownIllust;

const L = { stroke: "var(--ill-line)", strokeWidth: 3, strokeLinejoin: "round", strokeLinecap: "round" } as const;
const FILL = "var(--ill-paper)";

/** 鶏 1 羽（原点が胴の中心、右向き） */
function Hen({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-17 -4 l-9 -8 l2 12 z" fill={FILL} {...L} />
      <ellipse cx="0" cy="0" rx="17" ry="13" fill={FILL} {...L} />
      <circle cx="13" cy="-15" r="8" fill={FILL} {...L} />
      <path d="M9 -23 q3 -6 6 0 q3 -6 5 1" fill="var(--ill-red)" stroke="var(--ill-red)" strokeWidth="2" />
      <path d="M21 -15 l7 2 l-7 2 z" fill="var(--ill-warm)" />
      <circle cx="15" cy="-16" r="1.6" fill="var(--ill-line)" />
      <path d="M-3 13 v7 M5 13 v7" stroke="var(--ill-warm)" strokeWidth="3" strokeLinecap="round" />
    </g>
  );
}

/** 鶏舎（屋根と壁と戸） */
function House({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M0 24 L30 0 L60 24 Z" fill={FILL} {...L} />
      <rect x="6" y="24" width="48" height="32" fill={FILL} {...L} />
      <rect x="24" y="36" width="12" height="20" fill="var(--ill-bg)" {...L} strokeWidth={2.5} />
    </g>
  );
}

/** 禁止の印（赤い丸と斜線） */
function No({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <circle cx="0" cy="0" r="18" fill={FILL} fillOpacity="0.6" stroke="var(--ill-red)" strokeWidth="5" />
      <path d="M-12 -12 L12 12" stroke="var(--ill-red)" strokeWidth="5" />
    </g>
  );
}

/** 素手（指を広げた手） */
function Hand({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M8 6 v-6 a4 4 0 0 1 8 0 v18 M16 2 a4 4 0 0 1 8 0 v14 M0 8 a4 4 0 0 1 8 0 v10 M24 6 a4 4 0 0 1 8 0 v16 q0 16 -14 16 h-6 q-12 0 -16 -14 l-4 -10"
      fill={FILL}
      {...L}
    />
  );
}

/** 水の波（2 本） */
function Waves({ x, y, w }: { x: number; y: number; w: number }) {
  const seg = (yy: number) => {
    let d = `M${x} ${yy}`;
    for (let i = 0; i < w; i += 16) d += ` q4 -5 8 0 q4 5 8 0`;
    return d;
  };
  return <path d={`${seg(y)} ${seg(y + 10)}`} fill="none" stroke="var(--ill-water)" strokeWidth="3" strokeLinecap="round" />;
}

const BODY: Record<IllustName, ReactNode> = {
  // 鶏を飼っていない方へ
  approach: (
    <>
      <House x={16} y={38} />
      <path d="M12 96 H108" {...L} />
      <No x={88} y={38} />
    </>
  ),
  human_infection: (
    <>
      <circle cx="36" cy="44" r="12" fill={FILL} {...L} />
      <path d="M16 96 q0 -30 20 -30 q20 0 20 30 z" fill={FILL} {...L} />
      <Hen x={84} y={80} s={0.9} />
      <path d="M58 42 q8 -8 16 0" fill="none" stroke="var(--ill-water)" strokeWidth="3" strokeDasharray="3 5" strokeLinecap="round" />
    </>
  ),
  food: (
    <>
      <ellipse cx="36" cy="58" rx="16" ry="21" fill={FILL} {...L} />
      <ellipse cx="76" cy="80" rx="26" ry="10" fill={FILL} {...L} />
      <path d="M102 80 h10" {...L} strokeWidth={5} />
      <circle cx="76" cy="79" r="6" fill="var(--ill-warm)" />
      <path d="M64 54 q4 -8 0 -14 M76 52 q4 -8 0 -14 M88 54 q4 -8 0 -14" fill="none" stroke="var(--ill-red)" strokeWidth="2.5" strokeLinecap="round" />
    </>
  ),
  burial: (
    <>
      <rect x="14" y="50" width="92" height="52" fill="var(--ill-ground)" />
      <path d="M14 50 H106" {...L} />
      <path d="M14 88 H106" stroke="var(--ill-water)" strokeWidth="3" strokeDasharray="6 5" />
      <path d="M40 18 v28" {...L} strokeWidth={4} />
      <path d="M32 46 h16 l-3 14 h-10 z" fill={FILL} {...L} />
      <path d="M84 68 q-6 8 0 12 q6 -4 0 -12 z" fill="var(--ill-water)" />
    </>
  ),
  dead_bird: (
    <>
      <ellipse cx="42" cy="88" rx="24" ry="10" fill={FILL} {...L} />
      <path d="M30 84 q12 -8 22 0" fill="none" {...L} strokeWidth={2.5} />
      <circle cx="68" cy="84" r="7" fill={FILL} {...L} />
      <path d="M75 83 l7 2 l-7 2 z" fill="var(--ill-warm)" />
      <path d="M65 81 l5 5 M70 81 l-5 5" stroke="var(--ill-line)" strokeWidth="2" />
      <path d="M24 92 l-6 6 M30 96 l-4 7" {...L} strokeWidth={2.5} />
      <Hand x={26} y={20} s={1.15} />
      <No x={88} y={34} s={0.85} />
    </>
  ),
  rumor: (
    <>
      <path d="M16 24 h52 a8 8 0 0 1 8 8 v22 a8 8 0 0 1 -8 8 h-30 l-12 10 v-10 h-10 a8 8 0 0 1 -8 -8 v-22 a8 8 0 0 1 8 -8 z" fill={FILL} {...L} />
      <path d="M36 36 q0 -6 6 -6 q6 0 6 6 q0 5 -6 7 v4 M42 54 v1" fill="none" {...L} />
      <path d="M52 66 h44 a8 8 0 0 1 8 8 v16 a8 8 0 0 1 -8 8 h-4 v8 l-10 -8 h-30 a8 8 0 0 1 -8 -8 v-16 a8 8 0 0 1 8 -8 z" fill="var(--ill-warm-pale)" {...L} />
      <path d="M64 82 l6 6 l12 -12" fill="none" stroke="var(--ill-green)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  small_flock: (
    <>
      <Hen x={36} y={62} s={0.8} />
      <Hen x={30} y={94} s={0.7} />
      <Hen x={64} y={88} s={0.8} />
      <rect x="80" y="18" width="24" height="40" rx="4" fill={FILL} {...L} />
      <path d="M86 26 h12" {...L} strokeWidth={2} />
      <circle cx="92" cy="50" r="3" fill="var(--ill-line)" />
    </>
  ),
  // 分かっていること
  recurrence: (
    <>
      <House x={10} y={46} />
      <path d="M100 52 a18 18 0 1 0 -4 14" fill="none" stroke="var(--ill-water)" strokeWidth="4" strokeLinecap="round" />
      <path d="M102 38 v14 h-14" fill="none" stroke="var(--ill-water)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 104 H112" {...L} />
    </>
  ),
  "basic-management": (
    <>
      <rect x="20" y="16" width="56" height="78" rx="4" fill={FILL} {...L} />
      <path d="M30 34 l5 5 l9 -10 M30 56 l5 5 l9 -10 M30 78 l5 5 l9 -10" fill="none" stroke="var(--ill-green)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M50 36 h18 M50 58 h18 M50 80 h18" {...L} strokeWidth={2.5} />
      <Hen x={88} y={88} s={0.8} />
    </>
  ),
  "water-and-flock-size": (
    <>
      <Waves x={10} y={90} w={48} />
      <path d="M20 84 v-34 M30 84 v-28 M40 84 v-36" stroke="var(--ill-green)" strokeWidth="3" strokeLinecap="round" />
      <rect x="17" y="46" width="6" height="14" rx="3" fill="var(--ill-ground)" stroke="var(--ill-line)" strokeWidth="2" />
      <rect x="37" y="44" width="6" height="14" rx="3" fill="var(--ill-ground)" stroke="var(--ill-line)" strokeWidth="2" />
      <Hen x={72} y={48} s={0.6} />
      <Hen x={98} y={54} s={0.6} />
      <Hen x={78} y={78} s={0.6} />
      <Hen x={102} y={88} s={0.55} />
    </>
  ),
  "small-flock": (
    <>
      <Hen x={42} y={70} s={0.9} />
      <Hen x={76} y={84} s={0.8} />
      <path d="M12 104 H108" {...L} />
    </>
  ),
  "changing-shoes": (
    <>
      <path d="M18 24 h22 v42 q0 4 4 4 h8 q10 0 10 10 v8 h-44 z" fill={FILL} {...L} />
      <path d="M18 34 h22" {...L} strokeWidth={2.5} />
      <path d="M18 88 h44" {...L} strokeWidth={5} />
      <path d="M64 24 h22 v42 q0 4 4 4 h8 q10 0 10 10 v8 h-44 z" fill="var(--ill-bg-strong)" {...L} />
      <path d="M64 34 h22" {...L} strokeWidth={2.5} />
      <path d="M64 88 h44" {...L} strokeWidth={5} />
      <path d="M44 48 h12 M51 42 l6 6 l-6 6" fill="none" stroke="var(--ill-water)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 102 H108" {...L} />
    </>
  ),
  "standard-measures": (
    <>
      <House x={10} y={30} s={1.1} />
      <path d="M17 56 h52 M17 66 h52 M17 76 h52 M28 56 v34 M40 56 v34 M52 56 v34 M64 56 v34" stroke="var(--ill-line)" strokeWidth="1.5" opacity="0.7" />
      <path d="M8 100 H112" {...L} />
      <ellipse cx="94" cy="90" rx="14" ry="9" fill="var(--ill-bar)" {...L} strokeWidth={2.5} />
      <circle cx="104" cy="80" r="5" fill="var(--ill-bar)" {...L} strokeWidth={2.5} />
      <circle cx="106" cy="88" r="1.5" fill="var(--ill-line)" />
      <path d="M80 92 q-8 4 -6 -6 q2 -8 -6 -8" fill="none" {...L} strokeWidth={2.5} />
    </>
  ),
  "neighbor-cases": (
    <>
      <House x={6} y={42} s={0.7} />
      <House x={72} y={42} s={0.7} />
      <path d="M30 96 H90" stroke="var(--ill-line)" strokeWidth="2.5" strokeDasharray="5 5" />
      <path d="M30 90 v12 M90 90 v12" {...L} strokeWidth={2.5} />
      <path d="M44 30 q16 -14 32 0" fill="none" stroke="var(--ill-water)" strokeWidth="3" strokeDasharray="3 5" strokeLinecap="round" />
    </>
  ),
};

export const ILLUST_NAMES = Object.keys(BODY) as IllustName[];

export function Illust({ name }: { name: IllustName }) {
  return (
    <svg className="illust" data-illust={name} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="112" height="112" rx="14" fill="var(--ill-bg)" />
      {BODY[name]}
    </svg>
  );
}
