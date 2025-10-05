import { ParamsSchema } from "@features/templating-engine";

/**
 * Resolve the UI modal title for a params schema.
 */
export function resolveModalTitleFromSchema(
    schema: ParamsSchema | undefined,
    mode?: boolean | string
): string | undefined {
    if (!schema) return undefined;

    if (mode !== undefined) {
        const key = typeof mode === "string" ? mode : mode ? "edit" : "create";
        type TitleKey = keyof NonNullable<ParamsSchema["titles"]>; // "create" | "edit"
        const candidate = schema.titles?.[key as TitleKey];
        return candidate ?? schema.title;
    }
    return schema.title;
}