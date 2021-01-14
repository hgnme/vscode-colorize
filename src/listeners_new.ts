'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import {
  window,
  workspace,
  ExtensionContext,
  Range,
  TextDocumentChangeEvent,
} from 'vscode';
import ColorUtil, { IDecoration, DocumentLine, LineExtraction } from './lib/util/color-util';
import VariablesManager from './lib/variables/variables-manager';
import EditorManager from './lib/editor-manager';
import { equals } from './lib/util/array';
import TasksRunner from './lib/tasks-runner';
import { extension, updateContextDecorations, generateDecorations, removeDuplicateDecorations } from './extension';
import { handleLineDiff, disposeDecorationsForEditedLines } from './listeners_old';

const taskRuner = new TasksRunner();

function getDecorationsToColorize(colors, variables): Map<number, IDecoration[]> {
  const decorations = generateDecorations(colors, variables, new Map());

  function filterDuplicated(A, B) {
    return A.filter((decoration: IDecoration) => {
      const exist = B.findIndex((_: IDecoration) => {
        const position = decoration.currentRange.isEqual(_.currentRange);
        if (decoration.rgb === null && _.rgb !== null) {
          return false;
        }
        const colors = equals(decoration.rgb, _.rgb);
        return position && colors;
      });
      return exist === -1;
    });
  }

  extension.editor.visibleRanges.forEach(range => {
    let i = range.start.line;

    for (i; i <= range.end.line + 1; i++) {
      if (extension.deco.has(i) === true && decorations.has(i) === true) {
        // compare and remove duplicate and remove deleted ones
        decorations.set(i, filterDuplicated(decorations.get(i), extension.deco.get(i)));
      }

      if (extension.deco.has(i) && !decorations.has(i)) {
        // dispose decorations
        extension.deco.get(i).forEach(decoration => decoration.dispose());
      }
    }
  });
  cleanDecorationMap(decorations);
  return decorations;
}

function getCurrentRangeText(): DocumentLine[] {
  const text = extension.editor.document.getText();
  const fileLines: DocumentLine[] = ColorUtil.textToFileLines(text);
  const lines: DocumentLine[] = [];
  extension.editor.visibleRanges.forEach((range: Range) => {
    let i = range.start.line;
    for (i; i <= range.end.line + 1; i++) {
      if (fileLines[i] && fileLines[i].line !== null) {
        lines.push(fileLines[i]);
      }
    }
  });
  return lines;
}

// Need to regenerate  variables decorations when base as changed
function* handleVisibleRangeEvent() {

  // trigger on ctrl + z ????
  // yield new Promise(resolve => setTimeout(resolve, 50));
  const text = extension.editor.document.getText();
  const fileLines: DocumentLine[] = ColorUtil.textToFileLines(text);
  const lines = getCurrentRangeText();
  yield VariablesManager.findVariablesDeclarations(extension.editor.document.fileName, fileLines);
  const variables: LineExtraction[] = yield VariablesManager.findVariables(extension.editor.document.fileName, lines);
  const colors: LineExtraction[] = yield ColorUtil.findColors(lines);

  const decorations = getDecorationsToColorize(colors, variables);
  EditorManager.decorate(extension.editor, decorations, extension.currentSelection);
  updateContextDecorations(decorations, extension);
  removeDuplicateDecorations(extension);
}


function* updateDecorations() {
  yield new Promise(resolve => setTimeout(resolve, 50));
  const fileName = extension.editor.document.fileName;
  const fileLines: DocumentLine[] = ColorUtil.textToFileLines(extension.editor.document.getText());
  const lines = getCurrentRangeText();

  VariablesManager.removeVariablesDeclarations(extension.editor.document.fileName);
  cleanDecorationMap(extension.deco);

  yield VariablesManager.findVariablesDeclarations(fileName, fileLines);
  const variables: LineExtraction[] = yield VariablesManager.findVariables(fileName, lines);
  const colors: LineExtraction[] = yield ColorUtil.findColors(lines);
  const decorations = getDecorationsToColorize(colors, variables);
  // removeDuplicateDecorations(decorations);
  // EditorManager.decorate(context.editor, decorations, context.currentSelection);
  EditorManager.decorate(extension.editor, decorations, extension.currentSelection);
  updateContextDecorations(decorations, extension);
  removeDuplicateDecorations(extension);
}

function cleanDecorationMap(decorations: Map<number, IDecoration[]>) {
  const it = decorations.entries();
  let tmp = it.next();
  while (!tmp.done) {
    const line = tmp.value[0];
    const deco = tmp.value[1];
    decorations.set(line, deco.filter(decoration => !decoration.disposed));
    tmp = it.next();
  }
}

function handleChangeTextDocument(event: TextDocumentChangeEvent) {
  if (event.contentChanges.length === 0) {
    return;
  }
  if (extension.editor && event.document.fileName === extension.editor.document.fileName) {
    extension.editor = window.activeTextEditor;
    let editedLine = event.contentChanges.map(_ => _);

    const diffLine = extension.editor.document.lineCount - extension.nbLine;
    if (diffLine !== 0) {
      editedLine = handleLineDiff(editedLine, extension, diffLine);
      extension.nbLine = extension.editor.document.lineCount;
    }
    disposeDecorationsForEditedLines(editedLine, extension);
    taskRuner.run(updateDecorations);
  }
}

function setupEventListeners(context: ExtensionContext): void {
  // window.onDidChangeTextEditorSelection((event) => q.push((cb) => handleTextSelectionChange(event, cb)), null, context.subscriptions);
  workspace.onDidChangeTextDocument(handleChangeTextDocument, null, context.subscriptions);
  window.onDidChangeTextEditorVisibleRanges(() => taskRuner.run(handleVisibleRangeEvent), null, context.subscriptions);
  // window.onDidChangeTextEditorVisibleRanges(handleVisibleRangeEvent, null, context.subscriptions);
}

export default { setupEventListeners };
