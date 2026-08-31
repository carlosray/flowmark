# Checklist Reordering Design

## Goal

Let a user reorder checklist items inside the open-card modal by dragging a row to a new position. The interaction must preserve checklist item IDs and the existing filesystem format.

## Interaction

- Reordering is available only in the open-card modal.
- A checklist row normally renders without reserved drag-handle space.
- Hovering or focusing a row smoothly reveals a small `GripVertical` handle on its left and shifts that row's existing content to the right. Other rows keep their handles hidden.
- Dragging starts only from the handle, so completing an item, editing its Markdown text, selecting text, and deleting the item keep their current behavior.
- The dragged row follows the pointer. Neighboring rows animate into their prospective positions.
- Pointer, touch, and keyboard sensors are supported. The handle has an accessible reorder label.
- Cancelling a drag leaves the order unchanged.

## Components and data flow

The checklist section in `CardModal.tsx` owns a nested `DndContext` and vertical `SortableContext`. A small sortable row component applies the transform and transition supplied by `@dnd-kit/sortable`, while a `DragOverlay` renders the lifted row without changing its controls.

On a successful drop, the modal calculates the new item-ID order with `arrayMove` and calls a focused `BoardStore` checklist reorder method. The store replaces only that card's checklist array and schedules the existing board persistence path.

`board-repository.ts` already serializes checklist array order into stable numeric `position` values using an atomic `FileMutation`; no workspace schema change or new state is required. Existing item IDs, text, and completion state are preserved.

## Failure behavior

Invalid or no-target drops are no-ops. Persistence failures use the existing store rollback and disconnected-state behavior, restoring the last confirmed board.

## Testing

- Store test: reordering changes only item order, preserves item values, and persists once.
- Repository test: reordered items round-trip through YAML and strict workspace validation.
- UI source/render tests: the modal uses a vertical sortable list, a handle-only activator with an accessible label, animated transforms, and a row drag overlay.
- Run the focused tests, then the full test, typecheck, lint, formatting, production build, binary smoke, and strict workspace-validation gates required by the repository.
