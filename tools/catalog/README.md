# Offline catalog import

The importer accepts a metadata-only JSON manifest from a source that permits reuse. Do not place
problem statements, editorials, solutions, or source code in the manifest.

It also accepts the LeetCode metadata CSV shape used by the offline dogfood import. CSV inputs are
converted to the manifest shape using `ID`, `Title`, `Difficulty`, `Link`, `Topics`, `Premium Only`,
and `Category`.

The source must provide a license or written authorization for the metadata. The importer records
the dataset version, license, mapping version, and a short source snapshot hash in the import batch
name. It never sends the source data to LeetCode.

## Manifest format

```json
{
  "version": 1,
  "source": {
    "kind": "CURATED",
    "name": "Licensed problem metadata",
    "datasetVersion": "2026-09-18",
    "license": "Example license",
    "url": "https://example.com/dataset"
  },
  "rows": [
    {
      "leetcodeId": 1,
      "slug": "two-sum",
      "title": "Two Sum",
      "difficulty": "Easy",
      "isPaidOnly": false,
      "tags": ["array", "hash-table"]
    }
  ]
}
```

Rows may provide `patterns` instead of `tags` when they already use the Practice++ taxonomy.
When `tags` are used, every tag must appear in the mapping file or the ignored list. Availability
must be supplied as `availability` or `isPaidOnly`; unknown availability is quarantined.

## Commands

From the repository root:

```powershell
pnpm catalog:validate -- --input C:\path\metadata.json --mapping tools\catalog\leetcode-tag-map.json
pnpm catalog:import -- --input C:\path\metadata.json --mapping tools\catalog\leetcode-tag-map.json --admin-profile-id <administrator-profile-uuid>
pnpm catalog:validate -- --input C:\path\Leetcode.csv --mapping tools\catalog\leetcode-tag-map.json --source-name "User-supplied LeetCode metadata" --dataset-version 2026-09-18 --license "User-authorized private dogfood use"
pnpm catalog:import -- --input C:\path\Leetcode.csv --mapping tools\catalog\leetcode-tag-map.json --source-name "User-supplied LeetCode metadata" --dataset-version 2026-09-18 --license "User-authorized private dogfood use" --admin-profile-id <administrator-profile-uuid>
```

Validation writes `<input>.quarantine.json` when rows cannot be safely classified. Import refuses
to write any rows while quarantine exists unless `--allow-quarantine` is supplied. Quarantined
output contains only safe metadata fields, never arbitrary source properties.

Imported rows are inserted as unpublished drafts in one transaction. Review and publication remain
separate administrator actions. When a row resolves to more than three patterns, the importer keeps
the first three patterns in source order because the catalog contract allows at most three.
