#!/usr/bin/env node
// The entry point of the wake hook that `aipool peer install` adds to Claude
// Code's settings. See rewake() in peer.js.

import { rewakeMain } from './peer.js';

process.exit(await rewakeMain());
