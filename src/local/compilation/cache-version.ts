import { version } from '../../../package.json';
import { LOCAL_EMBEDDING_PROFILE_VERSION } from '../configuration/embedding';
import { LOCAL_RECOVERY_STRATEGY_VERSION } from '../configuration/options-core';
import { LOCAL_SYNTAX_VERSION } from '../types';

export const LOCAL_COMPILE_CACHE_VERSION = `rmd-compile/v1:${version}:${LOCAL_SYNTAX_VERSION}:${LOCAL_RECOVERY_STRATEGY_VERSION}:${LOCAL_EMBEDDING_PROFILE_VERSION}`;
