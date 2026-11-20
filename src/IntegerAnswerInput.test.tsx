// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import IntegerAnswerInput, {
  IntegerResponseEditor,
} from "./IntegerAnswerInput";
import type { IntegerAnswer } from "./answers";
import AnswerKeys, { NewExamModal } from "./AnswerKeys";
import { blankWorkspace } from "./data";
import type { Exam } from "./data";

// Rendering/printing itself is covered with real canvases/OpenCV in browser QA.
vi.mock("./omr", () => ({ downloadTemplatePDF: vi.fn(async () => {}) }));
vi.mock("./session", () => ({ useSession: () => ({ phase: "demo" }) }));
afterEach(cleanup);

it("allows natural short-key typing while persisting a three-digit value", () => {
  const changed = vi.fn();
  function Input() {
    const [value, setValue] = useState<IntegerAnswer | null>(null);
    return (
      <IntegerAnswerInput
        value={value}
        label="Integer key"
        onChange={(v) => {
          changed(v);
          setValue(v);
        }}
      />
    );
  }
  render(<Input />);
  const input = screen.getByLabelText("Integer key") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "7" } });
  expect(changed).toHaveBeenLastCalledWith("007");
  expect(input.value).toBe("7");
  fireEvent.blur(input);
  expect(input.value).toBe("007");
  fireEvent.change(input, { target: { value: "1000" } });
  expect(input.value).toBe("007");
  fireEvent.change(input, { target: { value: "1e2" } });
  expect(input.value).toBe("007");
  fireEvent.change(input, { target: { value: "" } });
  expect(changed).toHaveBeenLastCalledWith(null);
});
it("does not human-verify a digit until the explicit confirm button is pressed", () => {
  const confirm = vi.fn();
  render(
    <IntegerResponseEditor
      value={null}
      question={20}
      disabled={false}
      onConfirm={confirm}
    />,
  );
  fireEvent.change(screen.getByLabelText("Question 21 integer response"), {
    target: { value: "42" },
  });
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm integer 042" }));
  expect(confirm).toHaveBeenCalledWith("042");
});
it("keeps integer verification disabled for read-only accounts", () => {
  const confirm = vi.fn();
  render(
    <IntegerResponseEditor
      value="007"
      question={0}
      disabled
      onConfirm={confirm}
    />,
  );
  const button = screen.getByRole("button", {
    name: "Confirm integer 007",
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(confirm).not.toHaveBeenCalled();
});
it("creates an actual numeric assessment from the new integer option", () => {
  const create = vi.fn();
  render(<NewExamModal onClose={vi.fn()} onCreate={create} />);
  fireEvent.change(screen.getByLabelText("Assessment name"), {
    target: { value: "Integer paper" },
  });
  fireEvent.change(screen.getByLabelText("Subject"), {
    target: { value: "Maths" },
  });
  fireEvent.change(screen.getByLabelText("Number of questions"), {
    target: { value: "5" },
  });
  fireEvent.change(screen.getByLabelText("Answer options"), {
    target: { value: "integer3" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Create answer key" }).closest("form")!,
  );
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      questions: 5,
      questionTypes: Array(5).fill("integer3"),
      answers: Array(5).fill(null),
      published: false,
    }),
  );
});
it("supports mixed key entry and leaves existing types locked when results exist", () => {
  const w = blankWorkspace({ id: "school", name: "School", code: "S" }),
    save = vi.fn();
  const exam: Exam = {
    ...w.exams[0],
    questions: 2,
    answers: ["A", null],
    questionTypes: ["choice", "integer3"],
  };
  w.exams = [exam];
  const props = {
    workspace: w,
    exam,
    setExamId: vi.fn(),
    onSave: save,
    onCreate: vi.fn(),
    navigate: vi.fn(),
    toast: vi.fn(),
  };
  const { rerender } = render(<AnswerKeys {...props} />);
  fireEvent.change(
    screen.getByLabelText("Question 2, three-digit integer answer"),
    { target: { value: "7" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Save answer key" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ answers: ["A", "007"], published: true }),
  );
  const locked = { ...w, results: [{ examId: exam.id }] as typeof w.results };
  rerender(<AnswerKeys {...props} workspace={locked} />);
  expect(
    (screen.getByLabelText("Question 1 answer type") as HTMLSelectElement)
      .disabled,
  ).toBe(true);
  expect(
    (
      screen.getByRole("button", {
        name: "Apply type to range",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
it("mixed paste keeps integer tokens intact and rejects signed/decimal values", () => {
  const w = blankWorkspace({ id: "school", name: "School", code: "S" }),
    save = vi.fn();
  const exam: Exam = {
    ...w.exams[0],
    questions: 2,
    answers: [null, null],
    questionTypes: ["choice", "integer3"],
  };
  w.exams = [exam];
  render(
    <AnswerKeys
      workspace={w}
      exam={exam}
      setExamId={vi.fn()}
      onSave={save}
      onCreate={vi.fn()}
      navigate={vi.fn()}
      toast={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Paste answers" }));
  fireEvent.change(screen.getByLabelText("Your correct answers"), {
    target: { value: "A -1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply answers" }));
  expect(screen.getByText(/Enter exactly 2 answers/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Your correct answers"), {
    target: { value: "A 42" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply answers" }));
  fireEvent.click(screen.getByRole("button", { name: "Save answer key" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ answers: ["A", "042"] }),
  );
});
