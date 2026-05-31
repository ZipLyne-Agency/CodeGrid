import {
  getIconUrlForFilePath,
  getIconForDirectoryPath,
  getIconUrlByName,
} from "vscode-material-icons";

const ICON_BASE = "/assets/material-icons";

export function getFileIconUrl(fileName: string): string {
  return getIconUrlForFilePath(fileName, ICON_BASE);
}

export function getFolderIconUrl(folderName: string, isOpen: boolean): string {
  const iconName = getIconForDirectoryPath(folderName);
  const resolved = isOpen ? `${iconName}-open` : iconName;
  return getIconUrlByName(resolved as any, ICON_BASE);
}
