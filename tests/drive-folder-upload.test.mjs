import assert from "node:assert/strict";
import { build } from "esbuild";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { outputFiles: [bundle] } = await build({
	entryPoints: [join(root, "src/app/(drive)/drive-folder-upload.ts")],
	bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent",
	alias: { "@": join(root, "src") },
});
const upload = await import(`data:text/javascript;base64,${Buffer.from(bundle.contents).toString("base64")}`);

const directory = (name, ...batches) => ({
	name, isDirectory: true, isFile: false,
	createReader: () => {
		let index = 0;
		return { readEntries: done => queueMicrotask(() => done(batches[index++] ?? [])) };
	},
});
const fileEntry = (file) => ({ name: file.name, isFile: true, isDirectory: false, file: done => queueMicrotask(() => done(file)) });

test("dropping a folder uploads its files and subfolders, not the browser's zero-byte placeholder", async () => {
	const logo = new File(["logo data"], "logo.svg");
	const notes = new File([], "empty.txt");
	const cover = new File(["cover"], "cover.png");
	const directoryEntry = directory("vercuno-brandkit", [directory("logos", [fileEntry(logo)])], [directory("empty"), fileEntry(notes)]);
	const contents = await upload.collectDroppedDriveUpload({
		files: [new File([], directoryEntry.name), cover],
		items: [
			{ kind: "file", webkitGetAsEntry: () => directoryEntry },
			{ kind: "file", webkitGetAsEntry: () => fileEntry(cover) },
		],
	});
	assert.deepEqual(contents.folders, [["vercuno-brandkit"], ["vercuno-brandkit", "logos"], ["vercuno-brandkit", "empty"]]);
	assert.deepEqual(contents.files, [
		{ file: logo, parentPath: ["vercuno-brandkit", "logos"] },
		{ file: notes, parentPath: ["vercuno-brandkit"] },
		{ file: cover, parentPath: [] },
	]);
});

test("the folder picker groups files by their relative path", () => {
	const pick = (name, path) => Object.defineProperty(new File(["data"], name), "webkitRelativePath", { value: path });
	const files = [pick("one.png", "Kit/Logos/one.png"), pick("two.png", "Kit/Logos/two.png"), pick("readme.txt", "Kit/readme.txt")];
	const selection = upload.collectPickedDriveUpload(files, true);
	assert.deepEqual(selection.folders, [["Kit", "Logos"], ["Kit"]]);
	assert.deepEqual(selection.files.map(({ parentPath }) => parentPath), [["Kit", "Logos"], ["Kit", "Logos"], ["Kit"]]);
	assert.deepEqual(upload.collectPickedDriveUpload(files).files.map(({ parentPath }) => parentPath), [[], [], []]);
});

test("a readable empty file stays a file and an unreadable placeholder cannot be saved", async () => {
	const empty = new File([], "empty.txt");
	assert.deepEqual((await upload.collectDroppedDriveUpload({ files: [empty], items: [] })).files, [{ file: empty, parentPath: [] }]);
	const unreadable = { name: "dropped folder", size: 0, arrayBuffer: async () => { throw new Error("Not readable"); } };
	await assert.rejects(upload.collectDroppedDriveUpload({ files: [unreadable], items: [] }), /Not readable/);
});
