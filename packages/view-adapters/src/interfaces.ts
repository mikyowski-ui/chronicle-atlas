export interface ViewAdapter<State> { render(state: State): void }
export interface DisposableViewAdapter<State> extends ViewAdapter<State> { dispose(): void }
export interface ViewSelection { readonly entityId: string; readonly observationId: string }
export interface ViewSnapshot<Result> { readonly revision: number; readonly cursorYear: number; readonly result: Result | null; readonly selection: ViewSelection | null }
export interface SelectionPort { select(selection: ViewSelection, origin: string, revision: number): boolean }
export interface SpatialViewAdapter<Data> {
  update(data: Data | null, cursorYear: number, selectedId: string | null): void;
  clear(): void;
}
