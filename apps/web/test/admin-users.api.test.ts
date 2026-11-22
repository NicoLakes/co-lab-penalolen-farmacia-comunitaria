import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import {
  AdminUsersApiError,
  createManagedUser,
  listManagedUsers,
  setManagedUserRole,
  setManagedUserStatus,
} from '../src/features/admin/admin-users.api.js';

afterEach(() => mock.restoreAll());

const sampleUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'vecino@penalolen.local',
  status: 'active' as const,
  roles: ['buyer' as const],
  createdAt: '2026-11-22T03:30:00.000Z',
};

test('listManagedUsers sends optional query and validates rows', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json([sampleUser]));
  const result = await listManagedUsers('vecino');

  assert.equal(fetchMock.mock.calls[0]?.arguments[0], '/api/admin/users?q=vecino');
  assert.deepEqual(result, [sampleUser]);
});

test('listManagedUsers rejects invalid response contracts', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json([{ ...sampleUser, roles: ['unknown'] }]));
  await assert.rejects(
    listManagedUsers(),
    (error: unknown) => error instanceof AdminUsersApiError && error.code === 'invalid_response',
  );
});

test('createManagedUser posts email and roles and surfaces duplicate 409 errors', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () =>
    Response.json({ ...sampleUser, roles: ['buyer', 'user_admin'] }, { status: 201 }),
  );
  const created = await createManagedUser(' vecino@penalolen.local ', ['buyer', 'user_admin', 'buyer']);
  assert.equal(fetchMock.mock.calls[0]?.arguments[0], '/api/admin/users');
  assert.equal(fetchMock.mock.calls[0]?.arguments[1]?.method, 'POST');
  assert.equal(
    fetchMock.mock.calls[0]?.arguments[1]?.body,
    JSON.stringify({ email: 'vecino@penalolen.local', roles: ['buyer', 'user_admin'] }),
  );
  assert.deepEqual(created.roles, ['buyer', 'user_admin']);

  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () =>
    Response.json({ code: 'email_already_exists' }, { status: 409 }),
  );
  await assert.rejects(
    createManagedUser('vecino@penalolen.local', ['buyer']),
    (error: unknown) =>
      error instanceof AdminUsersApiError
      && error.status === 409
      && error.code === 'email_already_exists',
  );
});

test('setManagedUserRole sends PUT for grant and DELETE for revoke including user_admin', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
  await setManagedUserRole(sampleUser.id, 'user_admin', true);
  await setManagedUserRole(sampleUser.id, 'buyer', false);

  assert.equal(
    fetchMock.mock.calls[0]?.arguments[0],
    `/api/admin/users/${sampleUser.id}/roles/user_admin`,
  );
  assert.equal(fetchMock.mock.calls[0]?.arguments[1]?.method, 'PUT');
  assert.equal(
    fetchMock.mock.calls[1]?.arguments[0],
    `/api/admin/users/${sampleUser.id}/roles/buyer`,
  );
  assert.equal(fetchMock.mock.calls[1]?.arguments[1]?.method, 'DELETE');
});

test('setManagedUserStatus sends PATCH with status and surfaces 403 errors', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () =>
    Response.json({ code: 'forbidden' }, { status: 403 }),
  );
  await assert.rejects(
    setManagedUserStatus(sampleUser.id, 'disabled'),
    (error: unknown) =>
      error instanceof AdminUsersApiError && error.status === 403 && error.code === 'forbidden',
  );
  assert.equal(fetchMock.mock.calls[0]?.arguments[1]?.method, 'PATCH');
  assert.equal(fetchMock.mock.calls[0]?.arguments[1]?.body, JSON.stringify({ status: 'disabled' }));
});
