// 端末に残す会員の印（設計書 2026-11-06-ui-frame 決定 15）。メニューの出し分けだけに使い、Firebase を読まない。
// 守る画面は今までどおり RequireMember が確かめるので、印は見せ方の目安で、権限ではない。
// localStorage が使えない環境（プライベートな閲覧など）でも投げない。
import { useSyncExternalStore } from "react";

export const MEMBER_KEY = "hpai.member.v1";

/** 同じタブの中の書き換えを知らせる（storage の知らせは別のタブにしか届かない） */
const CHANGED = "hpai-member-mark";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readMemberMark(): boolean {
  try {
    return storage()?.getItem(MEMBER_KEY) === "1";
  } catch {
    return false;
  }
}

/** ログインの状態を確かめられたときに呼ぶ。会員なら印を付け、そうでなければ外す */
export function writeMemberMark(member: boolean): void {
  if (readMemberMark() === member) return;
  try {
    const s = storage();
    if (!s) return;
    if (member) s.setItem(MEMBER_KEY, "1");
    else s.removeItem(MEMBER_KEY);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === MEMBER_KEY) onChange();
  };
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** 会員の印。付け外しで描き直す */
export function useMemberMark(): boolean {
  return useSyncExternalStore(subscribe, readMemberMark, () => false);
}
