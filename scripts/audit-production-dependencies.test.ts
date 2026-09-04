import assert from "node:assert/strict";
import test from "node:test";

import {
  collectProductionPackages,
  parseOsvBatchResponse,
  type ProductionPackage,
} from "./audit-production-dependencies.ts";

test("production dependency audit follows workspace links and ignores development-only entries", () => {
  const packages = collectProductionPackages([
    {
      dependencies: {
        "@aperture/runtime": {
          from: "@aperture/runtime",
          version: "link:../runtime",
          dependencies: {
            "@sinclair/typebox": {
              from: "@sinclair/typebox",
              version: "0.34.49",
            },
          },
          optionalDependencies: {
            "optional-package": {
              from: "optional-package",
              version: "2.0.0-beta.1",
            },
          },
        },
      },
      unsavedDependencies: {
        "development-only": {
          from: "development-only",
          version: "9.9.9",
        },
      },
    },
    {
      dependencies: {
        "@sinclair/typebox": {
          from: "@sinclair/typebox",
          version: "0.34.49",
        },
      },
    },
  ]);

  assert.deepEqual(packages, [
    { name: "@sinclair/typebox", version: "0.34.49" },
    { name: "optional-package", version: "2.0.0-beta.1" },
  ]);
});

test("production dependency audit rejects non-registry dependency versions", () => {
  assert.throws(
    () =>
      collectProductionPackages([
        {
          dependencies: {
            unsafe: { from: "unsafe", version: "github:owner/repository" },
          },
        },
      ]),
    /not pinned to an exact npm version/,
  );
});

test("OSV response parsing keeps exact package attribution and vulnerability ids", () => {
  const packages: ProductionPackage[] = [
    { name: "first", version: "1.0.0" },
    { name: "second", version: "2.0.0" },
  ];

  assert.deepEqual(
    parseOsvBatchResponse(
      {
        results: [
          {},
          {
            vulns: [
              { id: "GHSA-aaaa-bbbb-cccc", summary: "Unsafe behavior" },
              { id: "CVE-2099-0001" },
            ],
          },
        ],
      },
      packages,
    ),
    [
      {
        name: "second",
        version: "2.0.0",
        id: "GHSA-aaaa-bbbb-cccc",
        summary: "Unsafe behavior",
      },
      { name: "second", version: "2.0.0", id: "CVE-2099-0001" },
    ],
  );
});

test("OSV response parsing fails closed on incomplete or malformed results", () => {
  const packages: ProductionPackage[] = [{ name: "package", version: "1.0.0" }];

  assert.throws(() => parseOsvBatchResponse({ results: [] }, packages), /did not match/);
  assert.throws(
    () =>
      parseOsvBatchResponse(
        { results: [{ vulns: [], next_page_token: "more-results" }] },
        packages,
      ),
    /cannot be complete/,
  );
  assert.throws(
    () => parseOsvBatchResponse({ results: [{ vulns: [{ summary: "missing id" }] }] }, packages),
    /without an id/,
  );
});
