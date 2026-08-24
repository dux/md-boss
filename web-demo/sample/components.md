# Typed Fez components

A typed block renders through an editable Fez component in
`~/.config/md-boss/components`.
The filename carries an `md-` prefix: `md-info.fez` renders `::info` or `:::info`,
and attributes on the opening line become component props.

Right-click in the raw pane and pick Insert, or type `/` at the start of an empty
line, and the three shipped components are in that list.

```md
::info
Use this for contextual information.
:::

:::warning
Use this for destructive operations, security implications, or irreversible actions.
:::

:::details title="Implementation details"
Longer optional explanation.
:::
```

::info
Use this for contextual information.
:::

:::warning
Use this for destructive operations, security implications, or irreversible actions.
:::

:::details title="Implementation details"
Longer optional explanation, with **rendered markdown** still drawn inside.
:::

The Example page ends with a live gallery generated from every installed
component's required `<info>` and `<demo>` blocks.
Settings has a button that copies an LLM starter prompt describing those
components as they actually are on disk, so a local harness can build another
one into that folder.
