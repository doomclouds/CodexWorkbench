export function isErasedModuleReference(node) {
  return node.type === 'TSImportType' || node.importKind === 'type' || node.exportKind === 'type';
}

export function importsRuntimeBinding(node) {
  return (
    node.type === 'ImportDeclaration' &&
    !isErasedModuleReference(node) &&
    node.specifiers.some((member) => member.importKind !== 'type')
  );
}
