// /sample: 見本の農場の入口。会員だったらこう見える、を試す 2 つの画面（やること、記録）へのリンクと、架空であることの説明。
import { Link } from "react-router";
import { useSampleData } from "./SampleFrame";
import { SAMPLE_TEXT } from "./sampleTexts";

export default function SamplePage() {
  const data = useSampleData();
  return (
    <div className="sample-entry">
      <h1>{SAMPLE_TEXT.title}</h1>
      <p>{SAMPLE_TEXT.entryLead}</p>
      <p>{SAMPLE_TEXT.entryPlace}</p>
      <h2>{data.farm.name}</h2>
      <p>{SAMPLE_TEXT.entryHouses}</p>
      <ul className="sample-houses">
        {data.houses.map((h) => (
          <li key={h.id}>
            {h.name}（{h.birdType} {h.flockSize} 羽）
          </li>
        ))}
      </ul>
      <ul className="sample-entry-links">
        <li>
          <Link to="/sample/todo">{SAMPLE_TEXT.entryTodo}</Link>: {SAMPLE_TEXT.entryTodoNote}
        </li>
        <li>
          <Link to="/sample/record">{SAMPLE_TEXT.entryRecord}</Link>: {SAMPLE_TEXT.entryRecordNote}
        </li>
      </ul>
      <p>{SAMPLE_TEXT.entryExamples}</p>
    </div>
  );
}
