const v8 = (globalThis as any).process?.getBuiltinModule?.('v8');
if (v8?.startupSnapshot) v8.startupSnapshot.isBuildingSnapshot = () => false;
