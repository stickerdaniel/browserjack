export interface DiscoveredRuntime {
  appPath: string;
  bundleId: string;
  appVersion: string;
  buildVersion: string;
  teamId: string;
  architecture: NodeJS.Architecture;
  resourcesRoot: string;
  codexPath: string;
  nodePath: string;
  nodeReplPath: string;
  nodeModulesPath: string;
  chromePluginPath: string;
  pluginVersion: string;
  extensionId: string;
  nativeHostName: string;
  nativeHostPath: string;
  browserClientPath: string;
  browserClientSha256: string;
  cachedPluginPath?: string;
  cachedBrowserClientPath?: string;
  cachedBrowserClientSha256?: string;
  codexHome: string;
}
