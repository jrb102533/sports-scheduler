export interface JoinRequest {
  uid: string;
  displayName: string;
  email: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}
