// Supabase Gallery Script
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://fwcdxvnpcpyxywbjwyaa.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y2R4dm5wY3B5eHl3Ymp3eWFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5OTg5NjMsImV4cCI6MjA3MzU3NDk2M30.XEfxRw39wp5jMs3YWFszhFZ1_ZXOilraSBN8R1e3LOI';
const BUCKET = 'gallerybucket';
const PREFIX = '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

class ConveyorGallery {
    constructor() {
        this.container = document.getElementById('conveyor');
        this.emptyMessage = document.getElementById('empty');
        this.loadingMessage = document.getElementById('loading');
        this.photos = [];
        this.currentIndex = 0;
        this.updateInterval = null;
        
        this.init();
    }
    
    async init() {
        await this.loadPhotos();
        this.createConveyor();
        this.startAutoScroll();
        this.setupGestures();
        this.startAutoUpdate(); // Add auto-update
    }
    
    publicUrl(path) {
        return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    }
    
    async loadPhotos() {
        try {
            console.log('📤 Loading photos from Supabase...');
            
            const results = await this.fetchAllPhotos();
            
            // Only update if we found photos
            if (results.length > 0) {
                this.photos = results;
                this.loadingMessage.style.display = 'none';
                this.emptyMessage.style.display = 'none';
                console.log(`📷 Loaded ${this.photos.length} photos`);
                return true;
            } else if (this.photos.length === 0) {
                // Only show empty state if we have no photos at all
                this.loadingMessage.style.display = 'none';
                this.emptyMessage.style.display = 'flex';
                return false;
            }
            
            return false;
            
        } catch (error) {
            console.error('❌ Error loading photos:', error);
            if (this.photos.length === 0) {
                this.loadingMessage.style.display = 'none';
                this.emptyMessage.style.display = 'flex';
                this.emptyMessage.innerHTML = '<h2>Error loading photos</h2><p>Check console for details</p>';
            }
            return false;
        }
    }
    
    async fetchAllPhotos() {
        let page = 0, results = [];
        const pageSize = 100;
        
        while (true) {
            const { data, error } = await supabase.storage.from(BUCKET).list(PREFIX, {
                limit: pageSize,
                offset: page * pageSize,
                sortBy: { column: 'updated_at', order: 'desc' }
            });
            
            if (error) {
                console.error('❌ List error:', error);
                break;
            }
            
            if (!data?.length) break;
            
            for (const entry of data) {
                if (entry.id && entry.name) {
                    results.push({
                        path: PREFIX + entry.name,
                        name: entry.name,
                        url: this.publicUrl(PREFIX + entry.name),
                        updated: entry.updated_at
                    });
                }
            }
            
            if (data.length < pageSize) break;
            page++;
        }
        
        return results;
    }
    
    createConveyor() {
        if (this.photos.length === 0) return;
        
        // Create duplicated photos for seamless loop
        const allPhotos = [...this.photos, ...this.photos];
        
        allPhotos.forEach((photo, index) => {
            const photoElement = this.createPhotoElement(photo, index);
            this.container.appendChild(photoElement);
        });
        
        // Set container width for smooth scrolling
        const photoWidth = 400; // Width of each photo + margin
        this.container.style.width = `${allPhotos.length * photoWidth}px`;
    }
    
    createPhotoElement(photo, index) {
        const photoDiv = document.createElement('div');
        photoDiv.className = 'photo';
        
        const img = document.createElement('img');
        img.src = photo.url;
        img.alt = 'AR Photo';
        img.loading = 'lazy';
        
        // Add click to view full size
        photoDiv.addEventListener('click', () => {
            window.open(photo.url, '_blank');
        });
        
        // Add date overlay
        const dateOverlay = document.createElement('div');
        dateOverlay.className = 'date-overlay';
        const date = new Date(photo.updated || Date.now());
        dateOverlay.textContent = date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
        
        photoDiv.appendChild(img);
        photoDiv.appendChild(dateOverlay);
        
        return photoDiv;
    }
    
    startAutoScroll() {
        if (this.photos.length === 0) return;
        
        const photoWidth = 400;
        const totalWidth = this.photos.length * photoWidth;
        let currentPosition = 0;
        
        const scroll = () => {
            currentPosition += 0.5; // Adjust speed here (pixels per frame)
            
            // Reset position for seamless loop
            if (currentPosition >= totalWidth) {
                currentPosition = 0;
            }
            
            this.container.style.transform = `translateX(-${currentPosition}px)`;
            requestAnimationFrame(scroll);
        };
        
        scroll();
    }
    
    setupGestures() {
        // Pause on hover
        this.container.addEventListener('mouseenter', () => {
            this.container.style.animationPlayState = 'paused';
        });
        
        this.container.addEventListener('mouseleave', () => {
            this.container.style.animationPlayState = 'running';
        });
    }
    
    startAutoUpdate() {
        // Check for new photos every 5 seconds
        this.updateInterval = setInterval(async () => {
            await this.checkForNewPhotos();
        }, 5000);
        
        console.log('🔄 Auto-update started - checking for new photos every 5 seconds');
    }
    
    async checkForNewPhotos() {
        try {
            const latestPhotos = await this.fetchAllPhotos();
            
            // Find new photos by comparing with existing ones
            const existingNames = new Set(this.photos.map(p => p.name));
            const newPhotos = latestPhotos.filter(photo => !existingNames.has(photo.name));
            
            if (newPhotos.length > 0) {
                console.log(`🆕 Found ${newPhotos.length} new photos, adding to conveyor...`);
                
                // Add new photos to the beginning of our photos array (newest first)
                this.photos = [...newPhotos, ...this.photos];
                
                // Add new photos to the conveyor belt smoothly
                this.addNewPhotosToConveyor(newPhotos);
                
                // Hide empty message if it was showing
                if (this.emptyMessage.style.display === 'flex') {
                    this.emptyMessage.style.display = 'none';
                }
            }
        } catch (error) {
            console.error('❌ Error checking for new photos:', error);
        }
    }
    
    addNewPhotosToConveyor(newPhotos) {
        const photoWidth = 400;
        
        // Add new photos to the BEGINNING of the conveyor (immediate visibility)
        newPhotos.forEach((photo, index) => {
            const photoElement = this.createPhotoElement(photo, 0);
            photoElement.style.opacity = '0';
            photoElement.style.transform = 'scale(0.9)';
            
            // Insert at the beginning of the conveyor
            this.container.insertBefore(photoElement, this.container.firstChild);
            
            // Smooth fade-in animation
            setTimeout(() => {
                photoElement.style.transition = 'all 0.5s ease';
                photoElement.style.opacity = '1';
                photoElement.style.transform = 'scale(1)';
            }, index * 100); // Stagger the animations slightly
        });
        
        // Update container width for new photos
        const totalPhotos = this.container.children.length;
        this.container.style.width = `${totalPhotos * photoWidth}px`;
        
        console.log(`✨ ${newPhotos.length} new photos added to front of conveyor`);
    }
}

// Initialize gallery when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ConveyorGallery();
});

console.log('🎨 Gallery script loaded');
