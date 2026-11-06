#!/usr/bin/env node
import { writeChecksums } from './lib/dataset.mjs';

const { files, path } = writeChecksums();
console.log(`Wrote ${path} for ${files} dataset files.`);
