import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiResponse, Post } from '../models/post.model';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class PostService {
  private apiUrl = `${environment.apiUrl}/posts`;

  constructor(private http: HttpClient) {}

  getFeedPosts(page = 1, limit = 10): Observable<ApiResponse<Post[]>> {
    const params = new HttpParams().set('page', page.toString()).set('limit', limit.toString());
    return this.http.get<ApiResponse<Post[]>>(this.apiUrl, { params });
  }

  getMyPosts(page = 1, limit = 10): Observable<ApiResponse<Post[]>> {
    const params = new HttpParams().set('page', page.toString()).set('limit', limit.toString());
    return this.http.get<ApiResponse<Post[]>>(`${this.apiUrl}/mine`, { params });
  }

  getPostById(id: string): Observable<ApiResponse<Post>> {
    return this.http.get<ApiResponse<Post>>(`${this.apiUrl}/${id}`);
  }

  createPost(post: { title: string; content: string; tags?: string[]; imageUrl?: string; isPublic?: boolean }): Observable<ApiResponse<Post>> {
    return this.http.post<ApiResponse<Post>>(this.apiUrl, post);
  }

  updatePost(
    id: string,
    update: { title?: string; content?: string; tags?: string[]; isPublic?: boolean }
  ): Observable<ApiResponse<Post>> {
    return this.http.put<ApiResponse<Post>>(`${this.apiUrl}/${id}`, update);
  }

  deletePost(id: string): Observable<ApiResponse<{ message: string }>> {
    return this.http.delete<ApiResponse<{ message: string }>>(`${this.apiUrl}/${id}`);
  }

  likePost(id: string): Observable<ApiResponse<Post>> {
    return this.http.post<ApiResponse<Post>>(`${this.apiUrl}/${id}/like`, {});
  }

  unlikePost(id: string): Observable<ApiResponse<Post>> {
    return this.http.post<ApiResponse<Post>>(`${this.apiUrl}/${id}/unlike`, {});
  }

  uploadPostImage(file: File): Observable<{ success: boolean; imageUrl: string; message?: string }> {
    const formData = new FormData();
    formData.append('image', file);

    return this.http.post<{ success: boolean; imageUrl: string; message?: string }>(
      `${environment.apiUrl}/uploads/post-image`,
      formData
    );
  }
}
