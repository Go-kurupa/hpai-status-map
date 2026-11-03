// /sample/todo: M の「やること」の画面を、見本の農場の口で動かす（複製しない）。会員でなくても開ける。
import TodoPage from "../todo/TodoPage";
import { SampleFrame } from "./SampleFrame";

export default function SampleTodoPage() {
  return <SampleFrame>{() => <TodoPage />}</SampleFrame>;
}
