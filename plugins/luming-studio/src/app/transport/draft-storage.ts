export const studioDraftStorage = {
  keys(prefix: string): string[] {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) {
        keys.push(key);
      }
    }

    return keys;
  },
  read(key: string): string | null {
    return localStorage.getItem(key);
  },
  write(key: string, value: string): void {
    localStorage.setItem(key, value);
  },
  remove(key: string): void {
    localStorage.removeItem(key);
  },
};
