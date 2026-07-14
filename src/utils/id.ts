import { ObjectId } from 'mongodb';
import { nanoid } from 'nanoid';

export function generateId(): string {
  return new ObjectId().toHexString();
}

export function isValidObjectId(id: string): boolean {
  return ObjectId.isValid(id) && new ObjectId(id).toHexString() === id;
}

export function toObjectId(id: string): ObjectId {
  return new ObjectId(id);
}

// Short opaque token, for refresh-token JTIs etc.
export function generateOpaqueToken(): string {
  return nanoid(32);
}
