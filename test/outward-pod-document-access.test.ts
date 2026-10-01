import assert from "node:assert/strict";
import test from "node:test";
import {
  canManageOutwardPODDocument,
  outwardPODDocumentActions,
} from "../src/lib/outward-pod-document-access.ts";

test("all current ERP roles are enabled for POD document actions", () => {
  for (const role of ["admin", "semi_admin", "basic", "viewer"]) {
    for (const action of ["view", "add", "replace"] as const) {
      assert.equal(canManageOutwardPODDocument(role, action), true, `${role} ${action}`);
    }
  }
});

test("unknown roles fail closed", () => {
  assert.equal(canManageOutwardPODDocument("future_role", "view"), false);
  assert.equal(canManageOutwardPODDocument(null, "add"), false);
});

test("the manifest allows add only for empty fields and view/replace only for files", () => {
  assert.deepEqual(outwardPODDocumentActions("basic", false), {
    allowView: false,
    allowAdd: true,
    allowReplace: false,
  });
  assert.deepEqual(outwardPODDocumentActions("viewer", true), {
    allowView: true,
    allowAdd: false,
    allowReplace: true,
  });
});
