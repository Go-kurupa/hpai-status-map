import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 契約 4.2 の索引。`desc` のない列は昇順。
interface IndexField {
  fieldPath: string;
  order?: string;
}
interface IndexDef {
  collectionGroup: string;
  queryScope: string;
  fields: IndexField[];
}

const json = JSON.parse(readFileSync(resolve(__dirname, "../../firestore.indexes.json"), "utf8")) as {
  indexes: IndexDef[];
  fieldOverrides: unknown[];
};

function find(collectionGroup: string, fields: Array<[string, "ASCENDING" | "DESCENDING"]>): IndexDef | undefined {
  return json.indexes.find(
    (i) =>
      i.collectionGroup === collectionGroup &&
      i.fields.length === fields.length &&
      i.fields.every((f, n) => f.fieldPath === fields[n]![0] && f.order === fields[n]![1]),
  );
}

describe("firestore.indexes.json（契約 4.2）", () => {
  it("索引は 6 つだけで、すべてコレクション単位", () => {
    expect(json.indexes).toHaveLength(6);
    for (const i of json.indexes) expect(i.queryScope).toBe("COLLECTION");
    expect(Array.isArray(json.fieldOverrides)).toBe(true);
  });

  it.each([
    ["cases", [["season", "ASCENDING"], ["prefCode", "ASCENDING"]]],
    ["wildBirds", [["season", "ASCENDING"], ["date", "ASCENDING"]]],
    ["sentNotices", [["state", "ASCENDING"], ["timing", "ASCENDING"], ["queuedAt", "ASCENDING"]]],
    ["sentNotices", [["subjectId", "ASCENDING"], ["event", "ASCENDING"]]],
    ["reviewQueue", [["resolvedAt", "ASCENDING"], ["createdAt", "DESCENDING"]]],
    ["documents", [["readState", "ASCENDING"], ["fetchedAt", "ASCENDING"]]],
  ] as Array<[string, Array<[string, "ASCENDING" | "DESCENDING"]>]>)("%s %j がある", (group, fields) => {
    expect(find(group, fields)).toBeDefined();
  });

  it("reviewQueue の createdAt は DESCENDING（I-07 の orderBy('createdAt','desc') に合わせる）", () => {
    const i = json.indexes.find((x) => x.collectionGroup === "reviewQueue");
    expect(i?.fields.map((f) => `${f.fieldPath}:${f.order}`)).toEqual(["resolvedAt:ASCENDING", "createdAt:DESCENDING"]);
  });
});
