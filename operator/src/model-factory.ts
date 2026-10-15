import type {Config} from './config.js';
import type {Model} from './contracts.js';
import {OpenClawModel} from './model.js';
import {OllamaModel} from './ollama-model.js';

export function configuredModel(config:Config):Model{
  return config.inference?new OllamaModel(new URL(config.inference.baseUrl),config.inference)
    :new OpenClawModel(config.gatewayUrl,config.gatewayToken);
}
